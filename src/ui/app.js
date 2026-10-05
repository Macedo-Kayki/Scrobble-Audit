import { DEFAULT_SETTINGS, APP } from '../config.js';
import { AppError, ErrorKind, friendlyMessage, isAbort } from '../core/errors.js';
import { buildRange, runAudit, rangeKey } from '../core/audit.js';
import { DEFAULT_FILTERS, filterScrobbles, countBy, sortScrobbles, groupScrobbles, sortGroups } from '../core/filters.js';
import { computeStats } from '../core/stats.js';
import { trackKey } from '../core/model.js';
import { browserTimeZone, epochToInputValue, localParts, isValidTimeZone } from '../core/time.js';
import * as storage from '../core/storage.js';
import { toCSV, auditToJSON, scrobbleToRecord, rankingToRecords, downloadFile, safeFilename } from '../core/export.js';
import { parseImport, MAX_IMPORT_BYTES } from '../core/importer.js';
import { getSource } from '../sources/registry.js';
import { createStore, memo } from './store.js';
import { confirmDialog, toast } from './components/overlay.js';
import { fmtNum } from './dom.js';

const HISTORY_MAX = 20;

/** Controlador da aplicação: estado, ações e persistência. */
export function createApp() {
  const settings = { ...DEFAULT_SETTINGS, ...storage.load(storage.KEYS.settings, {}) };
  if (settings.timeZone && !isValidTimeZone(settings.timeZone)) settings.timeZone = '';
  const tz = settings.timeZone || browserTimeZone();
  const restored = restoreAudit();

  const store = createStore({
    settings,
    form: { username: '', ...defaultRangeInputs(tz), ...storage.load(storage.KEYS.form, {}) },
    history: storage.load(storage.KEYS.history, []),
    audit: restored.audit,
    auditPersisted: restored.audit ? true : null,
    status: 'idle', // idle | running | error
    progress: null,
    error: null,
    notice: restored.notice,
    filters: { ...DEFAULT_FILTERS, ...storage.load(storage.KEYS.filters, {}) },
    view: { tab: 'audit', group: 'none', sort: 'time_desc', page: 1, ...storage.load(storage.KEYS.ui, {}) },
    durations: new Map(Object.entries(storage.load(storage.KEYS.durations, {}))),
    durationJob: null,
    ranking: { range: null, entries: [], ...storage.load(storage.KEYS.ranking, {}) },
    rankingJob: null,
  });

  let auditCtrl = null;
  let durationCtrl = null;
  let rankingCtrl = null;

  // ---------- Persistência automática de fatias pequenas ----------
  const persisted = [
    ['settings', storage.KEYS.settings],
    ['form', storage.KEYS.form],
    ['filters', storage.KEYS.filters],
    ['history', storage.KEYS.history],
    ['ranking', storage.KEYS.ranking],
  ];
  let durationSaveTimer;
  store.subscribe((s, p) => {
    for (const [field, key] of persisted) if (s[field] !== p[field]) storage.save(key, s[field]);
    if (s.view !== p.view) storage.save(storage.KEYS.ui, { tab: s.view.tab, group: s.view.group, sort: s.view.sort });
    if (s.durations !== p.durations) {
      clearTimeout(durationSaveTimer);
      durationSaveTimer = setTimeout(() => storage.save(storage.KEYS.durations, Object.fromEntries(s.durations)), 500);
    }
  });

  // ---------- Derivados (memoizados) ----------
  const timeZoneOf = (s) => s.settings.timeZone || browserTimeZone();
  const playCountsOf = memo((scrobbles) => countBy(scrobbles, trackKey));
  const filteredOf = memo((scrobbles, filters, tzName, durations) => filterScrobbles(scrobbles, filters, { timeZone: tzName, durations, playCounts: playCountsOf(scrobbles) }));
  const statsOf = memo((list, tzName, range) => computeStats(list, { timeZone: tzName, range }));
  const rowsOf = memo((list, group, sort, scrobbles) => {
    if (group === 'none') return sortScrobbles(list, sort, { playCounts: playCountsOf(scrobbles) });
    return sortGroups(groupScrobbles(list, group), sort, group);
  });

  const derived = {
    timeZone: () => timeZoneOf(store.get()),
    source: () => getSource(store.get().settings.source),
    playCounts: () => playCountsOf(store.get().audit?.scrobbles || []),
    filtered() {
      const s = store.get();
      return s.audit ? filteredOf(s.audit.scrobbles, s.filters, timeZoneOf(s), s.durations) : [];
    },
    stats() {
      const s = store.get();
      return s.audit ? statsOf(this.filtered(), timeZoneOf(s), s.audit.range) : null;
    },
    rows() {
      const s = store.get();
      return s.audit ? rowsOf(this.filtered(), s.view.group, s.view.sort, s.audit.scrobbles) : [];
    },
    /** Há como chamar a API: key própria do usuário ou proxy da instância. */
    hasApiKey() {
      const src = this.source();
      return src.hasCredentials ? src.hasCredentials() : Boolean(store.get().settings.apiKey);
    },
    knownDurations() {
      const s = store.get();
      if (!s.audit) return 0;
      const keys = new Set(s.audit.scrobbles.map(trackKey));
      let n = 0;
      for (const k of keys) if (s.durations.get(k) != null) n++;
      return n;
    },
  };

  // ---------- Ações ----------
  const actions = {
    setForm(patch) {
      store.set((s) => ({ form: { ...s.form, ...patch } }));
    },

    setSettings(patch) {
      store.set((s) => ({ settings: { ...s.settings, ...patch } }));
      if ('theme' in patch) applyTheme(patch.theme);
    },

    setFilters(patch) {
      store.set((s) => ({ filters: { ...s.filters, ...patch }, view: { ...s.view, page: 1 } }));
    },

    resetFilters() {
      store.set((s) => ({ filters: { ...DEFAULT_FILTERS }, view: { ...s.view, page: 1 } }));
    },

    setView(patch) {
      store.set((s) => ({ view: { ...s.view, ...('page' in patch ? {} : { page: 1 }), ...patch } }));
    },

    applyPreset(id) {
      const range = presetRange(id, timeZoneOf(store.get()));
      if (range) actions.setForm(range);
    },

    async startAudit() {
      const s = store.get();
      if (!derived.hasApiKey()) {
        store.set({ status: 'error', error: { kind: ErrorKind.MISSING_API_KEY, message: friendlyMessage(new AppError(ErrorKind.MISSING_API_KEY)) } });
        return;
      }
      let range;
      try {
        range = buildRange({ startInput: s.form.start, endInput: s.form.end, timeZone: timeZoneOf(s), inclusiveEnd: s.settings.inclusiveEnd });
      } catch (e) {
        store.set({ status: 'error', error: { kind: e.kind, message: friendlyMessage(e) } });
        return;
      }
      range.warnings.forEach((w) => toast(w, 'warning', 8000));
      auditCtrl?.abort();
      auditCtrl = new AbortController();
      const ctrl = auditCtrl;
      store.set({ status: 'running', error: null, notice: null, progress: { phase: 'user', fetched: 0, expected: 0 } });
      try {
        const audit = await runAudit({
          source: derived.source(),
          username: s.form.username,
          range,
          signal: ctrl.signal,
          onProgress: throttle((p) => store.set({ progress: p })),
          confirmLarge: ({ expected, estimatedRequests }) =>
            confirmDialog({
              title: 'Auditoria grande',
              message: `Este intervalo tem ${fmtNum(expected)} scrobbles e exigirá cerca de ${fmtNum(estimatedRequests)} requisições (~${Math.ceil((estimatedRequests * 0.35) / 60)} min). Continuar?`,
              confirmLabel: 'Baixar tudo',
            }),
        });
        if (ctrl !== auditCtrl) return;
        const persistedOk = persistAudit(audit);
        store.set((st) => ({
          audit,
          auditPersisted: persistedOk,
          status: 'idle',
          progress: null,
          view: { ...st.view, page: 1 },
          form: { ...st.form, username: audit.username },
          history: pushHistory(st.history, audit),
        }));
        if (!persistedOk) toast('Auditoria concluída, mas grande demais para salvar no localStorage. Ela será perdida ao recarregar — exporte se precisar.', 'warning', 9000);
        notifyVerification(audit);
        // Mantém o ranking sincronizado se este usuário já estiver nele com o mesmo intervalo.
        const r = store.get().ranking;
        if (r.range && rangeKey(r.range) === rangeKey(audit.range) && r.entries.some((e) => same(e.username, audit.username))) {
          upsertRankingEntry(summarize(audit));
        }
      } catch (e) {
        if (ctrl !== auditCtrl) return;
        if (isAbort(e)) store.set({ status: 'idle', progress: null, notice: e.message !== 'Operação cancelada.' ? e.message : 'Auditoria cancelada.' });
        else store.set({ status: 'error', progress: null, error: { kind: e.kind || ErrorKind.UNKNOWN, message: friendlyMessage(e) } });
      } finally {
        if (ctrl === auditCtrl) auditCtrl = null;
      }
    },

    cancelAudit() {
      auditCtrl?.abort();
    },

    dismissError() {
      store.set({ error: null, status: 'idle' });
    },

    dismissNotice() {
      store.set({ notice: null });
    },

    clearAudit() {
      storage.remove(storage.KEYS.lastAudit);
      store.set({ audit: null, auditPersisted: null });
    },

    removeHistory(username) {
      store.set((s) => ({ history: s.history.filter((h) => !same(h.username, username)) }));
    },

    // ----- Durações (track.getInfo) -----
    async fetchDurations() {
      const s = store.get();
      const source = derived.source();
      if (!s.audit || !source.getTrackDuration) return;
      const pending = new Map();
      for (const sc of s.audit.scrobbles) {
        const k = trackKey(sc);
        if (!s.durations.has(k) && !pending.has(k)) pending.set(k, sc);
      }
      if (!pending.size) {
        toast('As durações de todas as músicas desta auditoria já foram consultadas.', 'info');
        return;
      }
      if (pending.size > 300) {
        const ok = await confirmDialog({
          title: 'Buscar durações',
          message: `Serão ${fmtNum(pending.size)} requisições (uma por música única, ~${Math.ceil((pending.size * 0.3) / 60)} min). As durações ficam em cache local. Continuar?`,
          confirmLabel: 'Buscar',
        });
        if (!ok) return;
      }
      durationCtrl = new AbortController();
      const ctrl = durationCtrl;
      let done = 0;
      store.set({ durationJob: { done, total: pending.size } });
      const queue = [...pending];
      const update = throttle(() => store.set({ durationJob: { done, total: pending.size } }), 300);
      try {
        const worker = async () => {
          while (queue.length && !ctrl.signal.aborted) {
            const [k, sc] = queue.shift();
            const ms = await source.getTrackDuration({ artist: sc.artist, track: sc.track }, { signal: ctrl.signal });
            store.set((st) => {
              const m = new Map(st.durations);
              m.set(k, ms);
              return { durations: m };
            });
            done++;
            update();
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        toast(`Durações consultadas: ${fmtNum(done)} músicas.`, 'success');
      } catch (e) {
        if (!isAbort(e)) toast(friendlyMessage(e), 'error');
      } finally {
        durationCtrl = null;
        store.set({ durationJob: null });
      }
    },

    cancelDurations() {
      durationCtrl?.abort();
    },

    // ----- Exportação -----
    exportAudit(format, scope = 'filtered') {
      const s = store.get();
      if (!s.audit) return;
      const tzName = timeZoneOf(s);
      const list = scope === 'filtered' ? sortScrobbles(derived.filtered(), 'time_asc') : sortScrobbles(s.audit.scrobbles, 'time_asc');
      const name = safeFilename('scrobble-audit', s.audit.username, String(s.audit.range.from), String(s.audit.range.to), scope);
      if (format === 'csv') {
        const records = list.map((sc) => scrobbleToRecord(sc, { timeZone: tzName, username: s.audit.username, durations: s.durations }));
        downloadFile(`${name}.csv`, toCSV(records, { delimiter: s.settings.csvDelimiter }), 'text/csv;charset=utf-8');
      } else {
        const stats = scope === 'filtered' ? derived.stats() : computeStats(s.audit.scrobbles, { timeZone: tzName, range: s.audit.range });
        downloadFile(`${name}.json`, auditToJSON({ audit: s.audit, scrobbles: list, filters: s.filters, stats, timeZone: tzName, durations: s.durations, scope }), 'application/json');
      }
    },

    exportScrobbles(list, label, format = 'csv') {
      const s = store.get();
      const tzName = timeZoneOf(s);
      const records = sortScrobbles(list, 'time_asc').map((sc) => scrobbleToRecord(sc, { timeZone: tzName, username: s.audit?.username, durations: s.durations }));
      const name = safeFilename('scrobble-audit', s.audit?.username, label);
      if (format === 'csv') downloadFile(`${name}.csv`, toCSV(records, { delimiter: s.settings.csvDelimiter }), 'text/csv;charset=utf-8');
      else downloadFile(`${name}.json`, JSON.stringify(records, null, 2), 'application/json');
    },

    exportRanking(format) {
      const { ranking, settings: st } = store.get();
      if (!ranking.range) return;
      const records = rankingToRecords(rankingRows(ranking).current, ranking);
      const name = safeFilename('scrobble-audit-ranking', String(ranking.range.from), String(ranking.range.to));
      if (format === 'csv') downloadFile(`${name}.csv`, toCSV(records, { delimiter: st.csvDelimiter }), 'text/csv;charset=utf-8');
      else {
        // `entries` (completas) permitem reimportar sem perdas; `ranking` é a versão plana, legível.
        const body = { kind: 'scrobble-audit/ranking', generator: { name: APP.name, version: APP.version }, generatedAt: new Date().toISOString(), range: ranking.range, ranking: records, entries: rankingRows(ranking).current };
        downloadFile(`${name}.json`, JSON.stringify(body, null, 2), 'application/json');
      }
    },

    // ----- Ranking -----
    async setRankingRangeFromForm() {
      const s = store.get();
      let range;
      try {
        range = buildRange({ startInput: s.form.start, endInput: s.form.end, timeZone: timeZoneOf(s), inclusiveEnd: s.settings.inclusiveEnd });
      } catch (e) {
        toast(friendlyMessage(e), 'error');
        return false;
      }
      const r = s.ranking;
      if (r.range && rangeKey(r.range) === rangeKey(range)) return true;
      if (r.entries.length) {
        const ok = await confirmDialog({
          title: 'Alterar intervalo do ranking',
          message: 'Todos os usuários do ranking precisarão ser reauditados com o novo intervalo para que a comparação seja justa. Continuar?',
          confirmLabel: 'Alterar intervalo',
        });
        if (!ok) return false;
      }
      store.set((st) => ({ ranking: { ...st.ranking, range } }));
      return true;
    },

    /** Adiciona usando a auditoria atual (se o intervalo bater) ou audita no intervalo do ranking. */
    async addCurrentAuditToRanking() {
      const s = store.get();
      if (!s.audit) return;
      if (!s.ranking.range) {
        store.set((st) => ({ ranking: { ...st.ranking, range: { ...s.audit.range, warnings: [] } } }));
      }
      const r = store.get().ranking;
      if (rangeKey(r.range) === rangeKey(s.audit.range)) {
        upsertRankingEntry(summarize(s.audit));
        toast(`${s.audit.username} adicionado ao ranking.`, 'success');
        return;
      }
      const ok = await confirmDialog({
        title: 'Intervalo diferente',
        message: 'O ranking usa outro intervalo de datas. Para comparar com justiça, este usuário será auditado no intervalo do ranking. Continuar?',
        confirmLabel: 'Auditar no intervalo do ranking',
      });
      if (ok) await actions.auditRankingUser(s.audit.username);
    },

    async auditRankingUser(username) {
      const name = String(username || '').trim();
      const r = store.get().ranking;
      if (!name || !r.range) return;
      if (!derived.hasApiKey()) {
        toast(friendlyMessage(new AppError(ErrorKind.MISSING_API_KEY)), 'error');
        return;
      }
      if (store.get().rankingJob) {
        toast('Aguarde a auditoria do ranking em andamento.', 'warning');
        return;
      }
      rankingCtrl = new AbortController();
      const ctrl = rankingCtrl;
      store.set({ rankingJob: { username: name, progress: null, queue: [] } });
      try {
        await auditForRanking(name, r.range, ctrl);
      } finally {
        rankingCtrl = null;
        store.set({ rankingJob: null });
      }
    },

    async refreshAllRanking() {
      const r = store.get().ranking;
      if (!r.range || !r.entries.length || store.get().rankingJob) return;
      rankingCtrl = new AbortController();
      const ctrl = rankingCtrl;
      const names = r.entries.map((e) => e.username);
      try {
        for (let i = 0; i < names.length && !ctrl.signal.aborted; i++) {
          store.set({ rankingJob: { username: names[i], progress: null, index: i + 1, count: names.length } });
          await auditForRanking(names[i], store.get().ranking.range, ctrl);
        }
      } finally {
        rankingCtrl = null;
        store.set({ rankingJob: null });
      }
    },

    cancelRanking() {
      rankingCtrl?.abort();
    },

    removeFromRanking(username) {
      store.set((s) => ({ ranking: { ...s.ranking, entries: s.ranking.entries.filter((e) => !same(e.username, username)) } }));
    },

    clearRanking() {
      store.set({ ranking: { range: null, entries: [] } });
    },

    /** Carrega usuário + intervalo do ranking no formulário e audita. */
    openInAudit(username) {
      const s = store.get();
      const r = s.ranking.range;
      if (r) {
        if (r.timeZone !== timeZoneOf(s)) actions.setSettings({ timeZone: r.timeZone });
        if (r.inclusiveEnd !== s.settings.inclusiveEnd) actions.setSettings({ inclusiveEnd: r.inclusiveEnd });
        actions.setForm({ username, start: r.startInput, end: r.endInput });
      } else actions.setForm({ username });
      actions.setView({ tab: 'audit' });
      actions.startAudit();
    },

    // ----- Importação -----
    /** Importa um arquivo exportado pelo app (auditoria ou ranking, JSON ou CSV). */
    async importFile(file) {
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) {
        toast(`Arquivo grande demais (máx. ${Math.round(MAX_IMPORT_BYTES / 1048576)} MB).`, 'error');
        return;
      }
      let result;
      try {
        result = parseImport(await file.text(), { fileName: file.name, fallbackTimeZone: timeZoneOf(store.get()) });
      } catch (e) {
        toast(`Não foi possível importar “${file.name}”: ${friendlyMessage(e)}`, 'error', 8000);
        return;
      }
      const s = store.get();

      if (result.kind === 'ranking') {
        if (s.rankingJob) return toast('Aguarde a auditoria do ranking em andamento.', 'warning');
        if (s.ranking.entries.length) {
          const ok = await confirmDialog({ title: 'Importar ranking', message: `Substituir o ranking atual (${s.ranking.entries.length} usuário(s)) pelo do arquivo?`, confirmLabel: 'Substituir' });
          if (!ok) return;
        }
        store.set((st) => ({ ranking: result.ranking, view: { ...st.view, tab: 'ranking' } }));
        toast(`Ranking importado: ${fmtNum(result.ranking.entries.length)} usuário(s).`, 'success');
        result.warnings.forEach((w) => toast(w, 'warning', 8000));
        return;
      }

      if (s.status === 'running') return toast('Aguarde a auditoria em andamento terminar.', 'warning');
      if (s.audit) {
        const ok = await confirmDialog({ title: 'Importar auditoria', message: `Substituir a auditoria atual (${s.audit.username}) pela do arquivo?`, confirmLabel: 'Substituir' });
        if (!ok) return;
      }
      const audit = result.audit;
      try {
        audit.sourceName = getSource(audit.source).name;
      } catch {
        /* fonte desconhecida: mantém o id */
      }
      const persistedOk = persistAudit(audit);
      store.set((st) => {
        let durations = st.durations;
        if (result.durations.size) {
          durations = new Map(st.durations);
          for (const [k, ms] of result.durations) if (durations.get(k) == null) durations.set(k, ms);
        }
        return { audit, auditPersisted: persistedOk, durations, status: 'idle', error: null, notice: null, view: { ...st.view, tab: 'audit', page: 1 } };
      });
      toast(`Auditoria importada: ${fmtNum(audit.scrobbles.length)} scrobbles de ${audit.username}.`, 'success');
      result.warnings.forEach((w) => toast(w, 'warning', 9000));
      if (!persistedOk) toast('A auditoria importada é grande demais para o localStorage e será perdida ao recarregar.', 'warning', 9000);
    },

    /** Refaz na fonte a auditoria importada (mesmo usuário e intervalo) para verificá-la. */
    reauditImported() {
      const s = store.get();
      const a = s.audit;
      if (!a) return;
      if (a.range.timeZone !== timeZoneOf(s)) actions.setSettings({ timeZone: a.range.timeZone });
      if (a.range.inclusiveEnd !== s.settings.inclusiveEnd) actions.setSettings({ inclusiveEnd: a.range.inclusiveEnd });
      actions.setForm({ username: a.username, start: a.range.startInput, end: a.range.endInput });
      actions.startAudit();
    },

    clearAllData() {
      storage.clearAll();
      location.reload();
    },
  };

  async function auditForRanking(name, range, ctrl) {
    try {
      const s = store.get();
      // Reaproveita a auditoria principal se for do mesmo usuário e intervalo.
      let audit = s.audit && same(s.audit.username, name) && rangeKey(s.audit.range) === rangeKey(range) ? s.audit : null;
      if (!audit) {
        audit = await runAudit({
          source: derived.source(),
          username: name,
          range,
          signal: ctrl.signal,
          onProgress: throttle((p) => store.set((st) => ({ rankingJob: st.rankingJob && { ...st.rankingJob, progress: p } }))),
        });
      }
      upsertRankingEntry(summarize(audit));
      notifyVerification(audit);
    } catch (e) {
      if (isAbort(e)) return;
      toast(`${name}: ${friendlyMessage(e)}`, 'error', 7000);
    }
  }

  function upsertRankingEntry(entry) {
    store.set((s) => {
      const entries = s.ranking.entries.filter((e) => !same(e.username, entry.username));
      entries.push(entry);
      return { ranking: { ...s.ranking, entries } };
    });
  }

  function notifyVerification(audit) {
    const v = audit.verification;
    if (v.status === 'missing') toast(`${audit.username}: ${fmtNum(v.fetchedInWindow)} de ${fmtNum(v.expected)} scrobbles coletados. Reaudite para tentar completar.`, 'warning', 9000);
    else if (v.status === 'extra') toast(`${audit.username}: a contagem da API mudou durante a auditoria (possível exclusão de scrobbles).`, 'warning', 9000);
  }

  return { store, actions, derived };
}

// ---------- Helpers ----------

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function summarize(audit) {
  const st = computeStats(audit.scrobbles, { timeZone: audit.range.timeZone });
  return {
    username: audit.username,
    source: audit.source,
    image: audit.user?.image || '',
    total: audit.scrobbles.length,
    uniqueTracks: st.uniqueTracks,
    uniqueArtists: st.uniqueArtists,
    uniqueAlbums: st.uniqueAlbums,
    topArtist: st.topArtists[0] || null,
    topTrack: st.topTracks[0] || null,
    topArtists: st.topArtists.slice(0, 5),
    topTracks: st.topTracks.slice(0, 5),
    first: st.first,
    last: st.last,
    shortGaps: st.shortGaps,
    verification: { status: audit.verification.status, expected: audit.verification.expected, fetchedInWindow: audit.verification.fetchedInWindow },
    rangeKey: rangeKey(audit.range),
    auditedAt: audit.finishedAt,
  };
}

/** Separa entradas atuais (mesmo intervalo) das desatualizadas e ordena. */
export function rankingRows(ranking) {
  const key = ranking.range ? rangeKey(ranking.range) : null;
  const current = ranking.entries.filter((e) => e.rangeKey === key).sort((a, b) => b.total - a.total || a.username.localeCompare(b.username));
  const stale = ranking.entries.filter((e) => e.rangeKey !== key);
  return { current, stale };
}

function pushHistory(history, audit) {
  const entry = { username: audit.username, source: audit.source, at: audit.finishedAt, total: audit.scrobbles.length };
  return [entry, ...history.filter((h) => !same(h.username, audit.username))].slice(0, HISTORY_MAX);
}

function persistAudit(audit) {
  const { scrobbles, ...meta } = audit;
  const res = storage.save(storage.KEYS.lastAudit, { meta, scrobbles: storage.encodeScrobbles(scrobbles) });
  if (!res.ok) storage.remove(storage.KEYS.lastAudit);
  return res.ok;
}

function restoreAudit() {
  const saved = storage.load(storage.KEYS.lastAudit, null);
  if (!saved?.meta || !saved.scrobbles) return { audit: null, notice: null };
  try {
    const scrobbles = storage.decodeScrobbles(saved.scrobbles);
    // gaps são derivados: recalcula
    for (let i = 0; i < scrobbles.length; i++) {
      scrobbles[i].gapPrev = scrobbles[i + 1] ? scrobbles[i].ts - scrobbles[i + 1].ts : null;
      scrobbles[i].gapNext = scrobbles[i - 1] ? scrobbles[i - 1].ts - scrobbles[i].ts : null;
    }
    return { audit: { ...saved.meta, scrobbles }, notice: null };
  } catch {
    return { audit: null, notice: 'Não foi possível restaurar a última auditoria salva.' };
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function throttle(fn, ms = 120) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    pendingArgs = args;
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...pendingArgs);
      }, ms - (now - last));
    }
  };
}

const pad = (n) => String(n).padStart(2, '0');
const wall = (y, m, d, h = 0, mi = 0, s = 0) => `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;

export function defaultRangeInputs(tz) {
  return presetRange('today', tz);
}

/** Intervalos rápidos, calculados no timezone ativo. */
export function presetRange(id, tz) {
  const nowSec = Math.floor(Date.now() / 1000);
  const p = localParts(nowSec, tz);
  const dayShift = (n) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  const nowInput = epochToInputValue(nowSec, tz);
  switch (id) {
    case 'today':
      return { start: wall(p.year, p.month, p.day), end: wall(p.year, p.month, p.day, 23, 59, 59) };
    case 'yesterday': {
      const y = dayShift(-1);
      return { start: wall(y.y, y.m, y.d), end: wall(y.y, y.m, y.d, 23, 59, 59) };
    }
    case 'last24h':
      return { start: epochToInputValue(nowSec - 86400, tz), end: nowInput };
    case 'last7d':
      return { start: epochToInputValue(nowSec - 7 * 86400, tz), end: nowInput };
    case 'thisMonth':
      return { start: wall(p.year, p.month, 1), end: nowInput };
    case 'lastMonth': {
      const first = new Date(Date.UTC(p.year, p.month - 2, 1));
      const last = new Date(Date.UTC(p.year, p.month - 1, 0));
      return {
        start: wall(first.getUTCFullYear(), first.getUTCMonth() + 1, 1),
        end: wall(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate(), 23, 59, 59),
      };
    }
    default:
      return null;
  }
}


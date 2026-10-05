import { html, raw, setHtml, $, $$, on, debounce, icon, fmtNum, fmtDec } from '../dom.js';
import { buildRange } from '../../core/audit.js';
import { activeFilterCount, GROUP_MODES, SORT_OPTIONS } from '../../core/filters.js';
import { trackKey } from '../../core/model.js';
import { ErrorKind } from '../../core/errors.js';
import { AUDIT } from '../../config.js';
import { listTimeZones, browserTimeZone, describeTimeZone, formatDateTime, formatDate, formatTime, formatDuration, formatTrackLength } from '../../core/time.js';
import { columnChart, barList } from '../components/charts.js';
import * as modals from './modals.js';
import { pickFile } from '../components/filePicker.js';

const PRESETS = [
  ['today', 'Hoje'],
  ['yesterday', 'Ontem'],
  ['last24h', 'Últimas 24h'],
  ['last7d', 'Últimos 7 dias'],
  ['thisMonth', 'Este mês'],
  ['lastMonth', 'Mês passado'],
];

const PHASES = {
  user: 'Validando usuário…',
  probe: 'Consultando total de scrobbles no intervalo…',
  fetch: 'Baixando scrobbles…',
  verify: 'Verificando contagem com a API…',
  reconcile: 'Reconciliando lacunas…',
  done: 'Finalizando…',
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function mountAuditView(root, app) {
  const { store, actions, derived } = app;
  setHtml(
    root,
    html`<div id="onboarding"></div>
      <form class="card query" id="audit-form" novalidate></form>
      <div id="audit-status" aria-live="polite"></div>
      <div id="audit-summary"></div>
      <div id="audit-charts" class="charts-grid"></div>
      <div id="audit-workspace" class="workspace" hidden>
        <aside class="card filters" id="filters-panel" aria-label="Filtros"></aside>
        <section class="card results" id="results" aria-label="Resultados"></section>
      </div>
      <div id="audit-empty"></div>`,
  );

  const form = $('#audit-form', root);
  renderForm(form, app);
  renderFilters($('#filters-panel', root), app);
  bindResults($('#results', root), app);
  bindSummary(root, app);

  let lastResultsKey = null;
  let lastChartsKey = null;

  const update = (s, p) => {
    if (!p || s.form !== p.form || s.settings !== p.settings) syncForm(form, s, app);
    if (!p || s.status !== p.status) toggleRunning(form, s.status === 'running');
    if (!p || s.history !== p.history) renderHistory(form, s.history);
    if (!p || s.settings !== p.settings) renderOnboarding($('#onboarding', root), app);
    if (!p || s.status !== p.status || s.progress !== p.progress || s.error !== p.error || s.notice !== p.notice) renderStatus($('#audit-status', root), s, app);
    if (!p || s.filters !== p.filters || s.durations !== p.durations || s.audit !== p.audit) syncFilters($('#filters-panel', root), s.filters, s.durations, s.audit);

    const filtered = derived.filtered();
    const tz = derived.timeZone();
    const summaryKey = [s.audit, filtered, tz, s.auditPersisted, s.ranking, s.status].map(identity);
    if (!p || summaryKey.some((v, i) => v !== update.lastSummary?.[i])) {
      update.lastSummary = summaryKey;
      renderSummary($('#audit-summary', root), s, app);
    }
    const chartsKey = `${tz}`;
    if (!p || filtered !== lastChartsKey?.filtered || chartsKey !== lastChartsKey?.tz) {
      lastChartsKey = { filtered, tz: chartsKey };
      renderCharts($('#audit-charts', root), s, app);
    }
    $('#audit-workspace', root).hidden = !s.audit;
    renderEmpty($('#audit-empty', root), s);
    const resultsKey = [s.audit, filtered, s.view, tz, s.settings.pageSize, s.durations, s.durationJob, s.filters].map(identity);
    if (!lastResultsKey || resultsKey.some((v, i) => v !== lastResultsKey[i])) {
      lastResultsKey = resultsKey;
      renderResults($('#results', root), s, app);
    }
  };
  store.subscribe(update);
  update(store.get(), null);
}

const identity = (x) => x;

/* =============== Formulário =============== */

function renderForm(form, app) {
  const { actions } = app;
  const zones = listTimeZones();
  const btz = browserTimeZone();
  setHtml(
    form,
    html`<div class="query-head">
        <h2 class="card-title">${icon('search', 18)} Nova auditoria</h2>
        <p class="muted small">Busca exata por timestamp real de cada scrobble, em qualquer intervalo.</p>
        <button type="button" class="btn btn-sm btn-ghost query-import" data-action="import" title="Abrir um JSON ou CSV exportado pelo Scrobble Audit (também dá para arrastar o arquivo para a página)">${icon('upload', 14)} Importar</button>
      </div>
      <div class="query-grid">
        <label class="field field-user">
          <span class="field-label">Usuário</span>
          <span class="input-icon">${icon('user', 16)}<input name="username" list="user-history" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="username da Last.fm" required /></span>
        </label>
        <label class="field">
          <span class="field-label">Início</span>
          <input type="datetime-local" step="1" name="start" required />
        </label>
        <label class="field">
          <span class="field-label">Fim</span>
          <input type="datetime-local" step="1" name="end" required />
        </label>
        <label class="field">
          <span class="field-label">Timezone</span>
          <select name="timeZone">
            <option value="">Navegador — ${btz}</option>
            ${zones.map((z) => html`<option value="${z}">${z}</option>`)}
          </select>
        </label>
        <div class="field field-submit">
          <button type="submit" class="btn btn-primary" data-role="submit">${icon('search', 16)} Auditar</button>
          <button type="button" class="btn" data-action="cancel" hidden>${icon('x', 16)} Cancelar</button>
        </div>
      </div>
      <div class="query-foot">
        <div class="chips" role="group" aria-label="Intervalos rápidos">
          ${PRESETS.map(([id, label]) => html`<button type="button" class="chip" data-preset="${id}">${label}</button>`)}
        </div>
        <p class="range-preview" id="range-preview"></p>
      </div>
      <div class="history" id="history"></div>
      <datalist id="user-history"></datalist>`,
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    actions.startAudit();
  });
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'username' || t.name === 'start' || t.name === 'end') actions.setForm({ [t.name]: t.value });
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'timeZone') actions.setSettings({ timeZone: e.target.value });
  });
  on(form, 'click', '[data-preset]', (_e, b) => actions.applyPreset(b.dataset.preset));
  on(form, 'click', '[data-action="cancel"]', () => actions.cancelAudit());
  on(form, 'click', '[data-action="import"]', async () => actions.importFile(await pickFile()));
  on(form, 'click', '[data-history]', (_e, b) => {
    actions.setForm({ username: b.dataset.history });
    form.elements.username.focus();
  });
  on(form, 'click', '[data-history-remove]', (e, b) => {
    e.stopPropagation();
    actions.removeHistory(b.dataset.historyRemove);
  });
}

function syncForm(form, s, app) {
  const el = form.elements;
  for (const name of ['username', 'start', 'end']) {
    if (el[name].value !== s.form[name] && document.activeElement !== el[name]) el[name].value = s.form[name] || '';
  }
  if (el.timeZone.value !== s.settings.timeZone) el.timeZone.value = s.settings.timeZone;
  const preview = $('#range-preview', form);
  try {
    const r = buildRange({ startInput: s.form.start, endInput: s.form.end, timeZone: app.derived.timeZone(), inclusiveEnd: s.settings.inclusiveEnd });
    const secs = r.to - r.from + 1;
    setHtml(
      preview,
      html`${icon('clock', 14)} <strong>${formatDateTime(r.from, r.timeZone)}</strong> → <strong>${formatDateTime(r.requestedTo, r.timeZone)}</strong>
        <span class="muted">· ${describeTimeZone(r.timeZone, r.from)} · ${formatDuration(secs)} · fim ${r.inclusiveEnd ? 'inclusivo' : 'exclusivo'} · Unix ${r.from}–${r.to}</span>
        ${r.warnings.length ? html`<span class="text-warning"> · ${r.warnings.join(' ')}</span>` : ''}`,
    );
    preview.classList.remove('invalid');
  } catch (e) {
    setHtml(preview, html`${icon('alert', 14)} ${e.message}`);
    preview.classList.add('invalid');
  }
}

function toggleRunning(form, running) {
  $('[data-role="submit"]', form).disabled = running;
  $('[data-action="cancel"]', form).hidden = !running;
  for (const el of form.querySelectorAll('input, select, .chip')) el.disabled = running;
}

function renderHistory(form, history) {
  setHtml(
    $('#user-history', form),
    history.map((h) => html`<option value="${h.username}"></option>`),
  );
  setHtml(
    $('#history', form),
    history.length
      ? html`<span class="muted small">Recentes:</span>
          ${history.slice(0, 10).map(
            (h) => html`<span class="history-chip">
              <button type="button" data-history="${h.username}" title="Auditado em ${new Date(h.at).toLocaleString('pt-BR')}">${h.username}</button>
              <button type="button" class="history-x" data-history-remove="${h.username}" aria-label="Remover ${h.username} do histórico">${icon('x', 12)}</button>
            </span>`,
          )}`
      : '',
  );
}

/* =============== Onboarding / status =============== */

function renderOnboarding(el, app) {
  if (app.derived.hasApiKey()) return setHtml(el, '');
  setHtml(
    el,
    html`<div class="card onboarding">
      <div>
        <h2 class="card-title">${icon('settings', 18)} Configure sua API key da Last.fm</h2>
        <ol class="steps">
          <li>Crie uma conta de API em <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener">last.fm/api/account/create</a> (é gratuito; o campo “Callback URL” pode ficar vazio).</li>
          <li>Copie a <strong>API key</strong> (não é necessário o “shared secret”).</li>
          <li>Cole em Configurações (fica só no seu navegador) — ou, para não expor a key, rode <code>python servidor.py</code> com a key no arquivo <code>.env</code> (veja o README).</li>
        </ol>
      </div>
      <button class="btn btn-primary" data-action="open-settings">Abrir configurações</button>
    </div>`,
  );
}

function renderStatus(el, s, app) {
  if (s.status === 'running' && s.progress) {
    const p = s.progress;
    const pct = p.expected ? Math.min(100, (p.fetched / p.expected) * 100) : null;
    return setHtml(
      el,
      html`<div class="card progress-card">
        <div class="progress-head">
          <span class="spinner" aria-hidden="true"></span>
          <strong>${PHASES[p.phase] || 'Processando…'}</strong>
          <span class="muted">${p.expected ? html`${fmtNum(p.fetched)} de ${fmtNum(p.expected)} scrobbles` : ''}${p.pass ? ` · passada ${p.pass}` : ''}</span>
          <button class="btn btn-sm" data-action="cancel-audit">Cancelar</button>
        </div>
        <div class="progress ${pct == null ? 'indeterminate' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" ${pct != null ? raw(`aria-valuenow="${Math.round(pct)}"`) : ''}>
          <span style="width:${pct ?? 30}%"></span>
        </div>
      </div>`,
    );
  }
  if (s.error) {
    const isKey = s.error.kind === ErrorKind.MISSING_API_KEY || s.error.kind === ErrorKind.INVALID_API_KEY;
    const retryable = [ErrorKind.RATE_LIMITED, ErrorKind.UNAVAILABLE, ErrorKind.NETWORK, ErrorKind.TIMEOUT, ErrorKind.INCONSISTENT, ErrorKind.UNKNOWN].includes(s.error.kind);
    return setHtml(
      el,
      html`<div class="alert alert-error" role="alert">
        ${icon('alert', 18)}
        <div class="alert-body"><strong>${errorTitle(s.error.kind)}</strong><p>${s.error.message}</p></div>
        <div class="alert-actions">
          ${isKey ? html`<button class="btn btn-sm" data-action="open-settings">Configurações</button>` : ''}
          ${retryable ? html`<button class="btn btn-sm" data-action="retry">${icon('refresh', 14)} Tentar novamente</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-action="dismiss-error" aria-label="Fechar">${icon('x', 14)}</button>
        </div>
      </div>`,
    );
  }
  if (s.notice) {
    return setHtml(
      el,
      html`<div class="alert alert-info">${icon('info', 18)}<div class="alert-body"><p>${s.notice}</p></div>
        <div class="alert-actions"><button class="btn btn-sm btn-ghost" data-action="dismiss-notice" aria-label="Fechar">${icon('x', 14)}</button></div></div>`,
    );
  }
  setHtml(el, '');
}

function errorTitle(kind) {
  return (
    {
      user_not_found: 'Usuário inexistente',
      private_profile: 'Perfil privado',
      invalid_api_key: 'API key inválida',
      missing_api_key: 'API key ausente',
      rate_limited: 'Limite da API',
      unavailable: 'API indisponível',
      network: 'Sem conexão',
      timeout: 'Tempo esgotado',
      invalid_input: 'Verifique os campos',
      inconsistent_response: 'Resposta inconsistente',
    }[kind] || 'Erro'
  );
}

function renderEmpty(el, s) {
  if (s.audit || s.status === 'running' || s.error) return setHtml(el, '');
  setHtml(
    el,
    html`<div class="empty-state">
      ${icon('logo', 40)}
      <h2>Audite qualquer intervalo de scrobbles</h2>
      <p class="muted">Informe um usuário e um intervalo exato — por exemplo <strong>05/10/2026 08:00 → 13:00</strong> — e o Scrobble Audit baixa, verifica e analisa cada scrobble pelo seu timestamp real.</p>
      <p class="muted small">Já tem uma auditoria exportada? <button type="button" class="link-inline" data-action="import-empty">Importe o arquivo</button> ou arraste-o para cá.</p>
    </div>`,
  );
}

/* =============== Resumo =============== */

function bindSummary(root, app) {
  const { actions } = app;
  on(root, 'click', '[data-action]', (e, el) => {
    const a = el.dataset.action;
    if (a === 'open-settings') modals.openSettings(app);
    else if (a === 'retry') actions.startAudit();
    else if (a === 'dismiss-error') actions.dismissError();
    else if (a === 'dismiss-notice') actions.dismissNotice();
    else if (a === 'cancel-audit') actions.cancelAudit();
    else if (a === 'audit-details') modals.openAuditDetails(app);
    else if (a === 'add-ranking') actions.addCurrentAuditToRanking();
    else if (a === 'top-artist') actions.setFilters({ artist: el.dataset.key, exact: true });
    else if (a === 'top-track') modals.openTrackTimes(app, el.dataset.key);
    else if (a === 'reaudit-imported') actions.reauditImported();
    else if (a === 'import-empty') pickFile().then((f) => actions.importFile(f));
  });
}

function renderSummary(el, s, app) {
  const a = s.audit;
  if (!a) return setHtml(el, '');
  const tz = app.derived.timeZone();
  const stats = app.derived.stats();
  const filtered = app.derived.filtered();
  const isFiltered = filtered.length !== a.scrobbles.length || activeFilterCount(s.filters) > 0;
  const v = a.verification;
  const u = a.user || {};
  const inRanking = s.ranking.entries.some((e) => e.username.toLowerCase() === a.username.toLowerCase() && s.ranking.range && e.rangeKey === `${s.ranking.range.from}-${s.ranking.range.to}`);
  const source = app.derived.source();
  const vInfo = {
    verified: { cls: 'ok', ic: 'check', title: 'Contagem verificada', text: html`${fmtNum(v.fetchedInWindow)} scrobbles coletados = ${fmtNum(v.expected)} informados pela ${a.sourceName} para a janela consultada.` },
    missing: { cls: 'warn', ic: 'alert', title: 'Contagem incompleta', text: html`${fmtNum(v.fetchedInWindow)} de ${fmtNum(v.expected)} scrobbles coletados após ${v.reconciliationPasses} reconciliação(ões). Reaudite para tentar completar.` },
    extra: { cls: 'warn', ic: 'alert', title: 'Contagem divergente', text: html`Coletados ${fmtNum(v.fetchedInWindow)}; a API informa agora ${fmtNum(v.expected)}. Provavelmente houve scrobbles excluídos durante a auditoria.` },
    imported: {
      cls: 'info',
      ic: 'upload',
      title: 'Importado de arquivo',
      text: html`${fmtNum(a.scrobbles.length)} scrobbles carregados de <strong>${a.imported?.fileName || 'arquivo'}</strong>, sem nova consulta à ${a.sourceName}.
        ${v.original?.status === 'verified' ? html`Na exportação, a contagem estava verificada (${fmtNum(v.original.expected)}).` : v.original ? html`Na exportação, o status era “${v.original.status}”.` : 'O arquivo não traz verificação.'}
        ${a.imported?.scope === 'filtered' ? html`<br /><span class="text-warning">Contém só o resultado filtrado da auditoria original.</span>` : ''}`,
    },
  }[v.status] || { cls: 'warn', ic: 'info', title: 'Não verificado', text: '' };
  const imp = a.imported;

  const top = stats.topTracks[0];
  const topA = stats.topArtists[0];
  setHtml(
    el,
    html`<div class="summary-grid">
      <div class="card user-card">
        ${u.image ? html`<img class="avatar" src="${u.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<div class="avatar avatar-fallback" aria-hidden="true">${a.username.slice(0, 1).toUpperCase()}</div>`}
        <div class="user-meta">
          <a class="user-name" href="${u.url || source.profileUrl(a.username)}" target="_blank" rel="noopener">${a.username} ${icon('external', 13)}</a>
          <span class="muted small">${[u.realName, u.country].filter(Boolean).join(' · ') || a.sourceName}</span>
          <span class="muted small">${u.playcount != null ? html`${fmtNum(u.playcount)} scrobbles no total` : ''}${u.registeredTs ? html` · desde ${formatDate(u.registeredTs, tz)}` : ''}</span>
        </div>
        <div class="user-actions">
          <button class="btn btn-sm" data-action="audit-details">${icon('info', 14)} Detalhes da auditoria</button>
          <button class="btn btn-sm ${inRanking ? '' : 'btn-primary-soft'}" data-action="add-ranking">${icon('trophy', 14)} ${inRanking ? 'Atualizar no ranking' : 'Adicionar ao ranking'}</button>
        </div>
      </div>
      <div class="card verify verify-${vInfo.cls}">
        <div class="verify-head">${icon(vInfo.ic, 18)} <strong>${vInfo.title}</strong></div>
        <p class="small">${vInfo.text}</p>
        <p class="small muted">${formatDateTime(a.range.from, a.range.timeZone)} → ${formatDateTime(a.range.requestedTo ?? a.range.to, a.range.timeZone)} · ${describeTimeZone(a.range.timeZone, a.range.from)}</p>
        ${imp
          ? html`<p class="small muted">${imp.exportedAt ? `Exportado em ${new Date(imp.exportedAt).toLocaleString('pt-BR')} · ` : ''}importado em ${new Date(imp.importedAt).toLocaleString('pt-BR')}${imp.rangeDerived ? ' · intervalo derivado dos dados' : ''}${s.auditPersisted === false ? ' · não salvo localmente' : ''}</p>
              <p><button class="btn btn-sm" data-action="reaudit-imported" ${s.status === 'running' ? 'disabled' : ''}>${icon('refresh', 14)} Reauditar na ${a.sourceName}</button></p>`
          : html`<p class="small muted">Auditado em ${new Date(a.finishedAt).toLocaleString('pt-BR')} · ${fmtNum(a.requests)} requisições · ${formatDuration(a.durationMs / 1000)}${s.auditPersisted === false ? ' · não salvo localmente' : ''}</p>`}
      </div>
    </div>
    <div class="tiles" aria-label="Estatísticas">
      ${tile('Scrobbles', fmtNum(stats.total), isFiltered ? `filtrados de ${fmtNum(a.scrobbles.length)}` : stats.perDay != null ? `${fmtDec(stats.perDay)} por dia` : '')}
      ${tile('Músicas únicas', fmtNum(stats.uniqueTracks))}
      ${tile('Artistas únicos', fmtNum(stats.uniqueArtists))}
      ${tile('Álbuns únicos', fmtNum(stats.uniqueAlbums), 'apenas com álbum informado')}
      ${tile('Música mais ouvida', top ? top.track : '—', top ? `${top.artist} · ${fmtNum(top.count)}×${stats.topTrackTies > 1 ? ` · empate com ${stats.topTrackTies - 1}` : ''}` : '', top ? { action: 'top-track', key: trackKey(top) } : null)}
      ${tile('Artista mais ouvido', topA ? topA.artist : '—', topA ? `${fmtNum(topA.count)} scrobbles${stats.topArtistTies > 1 ? ` · empate com ${stats.topArtistTies - 1}` : ''}` : '', topA ? { action: 'top-artist', key: topA.artist } : null)}
      ${tile('Intervalos < ' + AUDIT.shortGapSeconds + 's', fmtNum(stats.shortGaps), 'scrobbles muito próximos do anterior', null, stats.shortGaps > 0 ? 'tile-flag' : '')}
    </div>
    ${isFiltered ? html`<p class="muted small filtered-note">${icon('filter', 12)} Estatísticas e gráficos refletem os filtros ativos.</p>` : ''}`,
  );
}

function tile(label, value, sub = '', action = null, cls = '') {
  const inner = html`<span class="tile-label">${label}</span><span class="tile-value" title="${value}">${value}</span>${sub ? html`<span class="tile-sub">${sub}</span>` : ''}`;
  return action
    ? html`<button type="button" class="tile tile-action ${cls}" data-action="${action.action}" data-key="${action.key}">${inner}</button>`
    : html`<div class="tile ${cls}">${inner}</div>`;
}

/* =============== Gráficos =============== */

function renderCharts(el, s, app) {
  if (!s.audit) return setHtml(el, '');
  const stats = app.derived.stats();
  const tl = stats.timeline;
  const unitLabel = { hour: 'por hora', day: 'por dia', month: 'por mês' }[tl.unit];
  setHtml(
    el,
    html`<section class="card chart-card chart-wide">
        <h3 class="card-title">Scrobbles ${unitLabel}</h3>
        ${columnChart({ data: tl.buckets.map((b) => ({ label: b.label, value: b.count, tip: `${b.fullLabel}: ${fmtNum(b.count)} scrobbles` })), ariaLabel: `Scrobbles ${unitLabel} no intervalo`, maxLabels: 7 })}
      </section>
      <section class="card chart-card">
        <h3 class="card-title">Por hora do dia <span class="muted small">(${app.derived.timeZone()})</span></h3>
        ${columnChart({ data: stats.byHour.map((v, h) => ({ label: `${String(h).padStart(2, '0')}h`, value: v })), ariaLabel: 'Scrobbles por hora do dia', maxLabels: 8 })}
      </section>
      <section class="card chart-card">
        <h3 class="card-title">Por dia da semana</h3>
        ${columnChart({ data: stats.byWeekday.map((v, d) => ({ label: WEEKDAYS[d], value: v })), ariaLabel: 'Scrobbles por dia da semana', maxLabels: 7 })}
      </section>
      <section class="card chart-card">
        <h3 class="card-title">Top artistas</h3>
        ${barList({ rows: stats.topArtists.map((t) => ({ label: t.artist, value: t.count, key: t.artist })), ariaLabel: 'Top artistas', action: 'top-artist' })}
      </section>
      <section class="card chart-card">
        <h3 class="card-title">Top músicas</h3>
        ${barList({ rows: stats.topTracks.map((t) => ({ label: t.track, sub: t.artist, value: t.count, key: trackKey(t) })), ariaLabel: 'Top músicas', action: 'top-track' })}
      </section>`,
  );
}

/* =============== Filtros =============== */

function renderFilters(el, app) {
  const { actions } = app;
  setHtml(
    el,
    html`<details class="filters-details" open>
      <summary class="filters-summary"><span class="card-title">${icon('filter', 16)} Filtros <span class="badge" id="filter-count" hidden></span></span></summary>
      <div class="filters-body">
        <label class="field"><span class="field-label">Busca livre</span><input type="search" data-filter="query" placeholder="artista, música ou álbum" /></label>
        <label class="field"><span class="field-label">Artista</span><input type="search" data-filter="artist" /></label>
        <label class="field"><span class="field-label">Música</span><input type="search" data-filter="track" /></label>
        <label class="field"><span class="field-label">Álbum</span><input type="search" data-filter="album" /></label>
        <label class="check"><input type="checkbox" data-filter="exact" /> Correspondência exata <span class="muted small">(ignora maiúsculas/acentos)</span></label>

        <fieldset class="fieldset">
          <legend>Data <span class="muted small">(dentro do intervalo auditado)</span></legend>
          <div class="row-2">
            <label class="field"><span class="field-label">De</span><input type="date" data-filter="dateFrom" /></label>
            <label class="field"><span class="field-label">Até</span><input type="date" data-filter="dateTo" /></label>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend>Horário do dia</legend>
          <div class="row-2">
            <label class="field"><span class="field-label">De</span><input type="time" step="1" data-filter="timeFrom" /></label>
            <label class="field"><span class="field-label">Até</span><input type="time" step="1" data-filter="timeTo" /></label>
          </div>
          <p class="hint">Inclusivo. Aceita virar a meia-noite (ex.: 22:00 → 02:00).</p>
          <div class="weekday-chips" role="group" aria-label="Dias da semana">
            ${WEEKDAYS.map((d, i) => html`<button type="button" class="chip chip-sm" data-weekday="${i}" aria-pressed="false">${d}</button>`)}
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend>Reproduções da música no período</legend>
          <div class="row-2">
            <label class="field"><span class="field-label">Mín.</span><input type="number" min="1" step="1" inputmode="numeric" data-filter="playsMin" /></label>
            <label class="field"><span class="field-label">Máx.</span><input type="number" min="1" step="1" inputmode="numeric" data-filter="playsMax" /></label>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend>Duração da faixa (segundos)</legend>
          <div class="row-2">
            <label class="field"><span class="field-label">Mín.</span><input type="number" min="0" step="1" inputmode="numeric" data-filter="durationMin" /></label>
            <label class="field"><span class="field-label">Máx.</span><input type="number" min="0" step="1" inputmode="numeric" data-filter="durationMax" /></label>
          </div>
          <label class="check"><input type="checkbox" data-filter="includeUnknownDuration" /> Incluir duração desconhecida</label>
          <p class="hint" id="duration-hint"></p>
        </fieldset>

        <label class="check"><input type="checkbox" data-filter="shortGapOnly" /> Somente scrobbles a menos de ${AUDIT.shortGapSeconds}s de outro</label>

        <button type="button" class="btn btn-block" data-action="reset-filters">Limpar filtros</button>
      </div>
    </details>`,
  );
  if (window.matchMedia('(max-width: 900px)').matches) $('details', el).open = false;

  const push = debounce((name, value) => actions.setFilters({ [name]: value }), 180);
  el.addEventListener('input', (e) => {
    const t = e.target.closest('[data-filter]');
    if (!t) return;
    if (t.type === 'checkbox') actions.setFilters({ [t.dataset.filter]: t.checked });
    else push(t.dataset.filter, t.value);
  });
  on(el, 'click', '[data-weekday]', (_e, b) => {
    const d = Number(b.dataset.weekday);
    const cur = new Set(app.store.get().filters.weekdays);
    cur.has(d) ? cur.delete(d) : cur.add(d);
    actions.setFilters({ weekdays: [...cur].sort() });
  });
  on(el, 'click', '[data-action="reset-filters"]', () => actions.resetFilters());
}

function syncFilters(el, filters, durations, audit) {
  for (const input of $$('[data-filter]', el)) {
    const k = input.dataset.filter;
    if (input.type === 'checkbox') input.checked = Boolean(filters[k]);
    else if (document.activeElement !== input && input.value !== String(filters[k] ?? '')) input.value = filters[k] ?? '';
  }
  for (const b of $$('[data-weekday]', el)) b.setAttribute('aria-pressed', String(filters.weekdays.includes(Number(b.dataset.weekday))));
  const n = activeFilterCount(filters);
  const badge = $('#filter-count', el);
  badge.hidden = !n;
  badge.textContent = n;
  const hint = $('#duration-hint', el);
  const known = audit ? new Set(audit.scrobbles.map(trackKey)) : new Set();
  let k = 0;
  for (const key of known) if (durations.get(key) != null) k++;
  hint.textContent = audit ? `Duração conhecida para ${fmtNum(k)} de ${fmtNum(known.size)} músicas. Use “Buscar durações” na tabela.` : '';
}

/* =============== Resultados =============== */

function bindResults(el, app) {
  const { actions, store } = app;
  on(el, 'click', '[data-group]', (_e, b) => actions.setView({ group: b.dataset.group }));
  on(el, 'change', '[data-role="sort"]', (e) => actions.setView({ sort: e.target.value }));
  on(el, 'change', '[data-role="page-size"]', (e) => {
    actions.setSettings({ pageSize: Number(e.target.value) });
    actions.setView({ page: 1 });
  });
  on(el, 'click', '[data-page]', (_e, b) => actions.setView({ page: Number(b.dataset.page) }));
  on(el, 'click', '[data-export]', (_e, b) => {
    const [format, scope] = b.dataset.export.split(':');
    actions.exportAudit(format, scope);
    b.closest('details')?.removeAttribute('open');
  });
  on(el, 'click', '[data-action="durations"]', () => actions.fetchDurations());
  on(el, 'click', '[data-action="cancel-durations"]', () => actions.cancelDurations());
  on(el, 'click', '[data-action="reset-filters"]', () => actions.resetFilters());
  const openRow = (row) => {
    const s = store.get();
    if (row.dataset.scrobble) modals.openScrobble(app, row.dataset.scrobble);
    else if (row.dataset.trackKey) modals.openTrackTimes(app, row.dataset.trackKey);
    else if (row.dataset.artist) {
      actions.setFilters({ artist: row.dataset.artist, exact: true });
      actions.setView({ group: s.view.group === 'artist' ? 'none' : s.view.group });
    } else if (row.dataset.album) {
      actions.setFilters({ album: row.dataset.album, artist: row.dataset.albumArtist, exact: true });
      actions.setView({ group: 'none' });
    }
  };
  on(el, 'click', 'tr[data-row]', (_e, row) => openRow(row));
  on(el, 'keydown', 'tr[data-row]', (e, row) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openRow(row);
    }
  });
}

function renderResults(el, s, app) {
  if (!s.audit) return setHtml(el, '');
  const tz = app.derived.timeZone();
  const rows = app.derived.rows();
  const filtered = app.derived.filtered();
  const group = s.view.group;
  const pageSize = s.settings.pageSize || 100;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(s.view.page, pages);
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const playCounts = app.derived.playCounts();
  const anyDuration = app.derived.knownDurations() > 0;
  const job = s.durationJob;
  const source = app.derived.source();

  const countLabel =
    group === 'none'
      ? html`<strong>${fmtNum(filtered.length)}</strong> scrobbles${filtered.length !== s.audit.scrobbles.length ? html` <span class="muted">de ${fmtNum(s.audit.scrobbles.length)}</span>` : ''}`
      : html`<strong>${fmtNum(rows.length)}</strong> ${{ track: 'músicas', artist: 'artistas', album: 'álbuns' }[group]} <span class="muted">· ${fmtNum(filtered.length)} scrobbles</span>`;

  setHtml(
    el,
    html`<div class="results-toolbar">
        <div class="segmented" role="group" aria-label="Visualização">
          ${GROUP_MODES.map((g) => html`<button type="button" data-group="${g.id}" aria-pressed="${String(group === g.id)}">${g.label}</button>`)}
        </div>
        <label class="inline-field"><span class="sr-only">Ordenar</span>
          <select data-role="sort" aria-label="Ordenar por">
            ${SORT_OPTIONS.map((o) => html`<option value="${o.id}" ${s.view.sort === o.id ? 'selected' : ''}>${o.label}</option>`)}
          </select>
        </label>
        <span class="results-count">${countLabel}</span>
        <span class="spacer"></span>
        ${source.getTrackDuration
          ? job
            ? html`<button type="button" class="btn btn-sm" data-action="cancel-durations"><span class="spinner spinner-sm"></span> Durações ${fmtNum(job.done)}/${fmtNum(job.total)} · cancelar</button>`
            : html`<button type="button" class="btn btn-sm" data-action="durations" title="Consulta track.getInfo para cada música única (com cache local)">${icon('clock', 14)} Buscar durações</button>`
          : ''}
        <details class="dropdown">
          <summary class="btn btn-sm">${icon('download', 14)} Exportar</summary>
          <div class="dropdown-menu" role="menu">
            <button type="button" role="menuitem" data-export="csv:filtered">CSV — resultado filtrado</button>
            <button type="button" role="menuitem" data-export="json:filtered">JSON — resultado filtrado</button>
            <button type="button" role="menuitem" data-export="csv:all">CSV — auditoria completa</button>
            <button type="button" role="menuitem" data-export="json:all">JSON — auditoria completa</button>
          </div>
        </details>
      </div>
      ${rows.length
        ? html`<div class="table-wrap">${group === 'none' ? scrobbleTable(slice, { tz, playCounts, durations: s.durations, anyDuration, offset: (page - 1) * pageSize }) : groupTable(slice, group, tz)}</div>
            ${pagination(page, pages, pageSize, rows.length)}`
        : html`<div class="empty-inline">
            ${s.audit.scrobbles.length
              ? html`<p>Nenhum resultado para os filtros atuais.</p><button class="btn btn-sm" data-action="reset-filters">Limpar filtros</button>`
              : html`<p>Nenhum scrobble neste intervalo.</p><p class="muted small">A ${s.audit.sourceName} confirmou 0 scrobbles entre ${formatDateTime(s.audit.range.from, tz)} e ${formatDateTime(s.audit.range.to, tz)}.</p>`}
          </div>`}`,
  );
}

function scrobbleTable(list, { tz, playCounts, durations, anyDuration, offset }) {
  return html`<table class="table">
    <thead><tr>
      <th class="num">#</th><th>Data</th><th>Horário</th><th>Artista</th><th>Música</th><th>Álbum</th>
      <th class="num" title="Tempo desde o scrobble anterior">Δ anterior</th>
      ${anyDuration ? html`<th class="num">Duração</th>` : ''}
      <th class="num" title="Scrobbles desta música no período auditado">Plays</th>
    </tr></thead>
    <tbody>
      ${list.map((s, i) => {
        const short = s.gapPrev != null && s.gapPrev < AUDIT.shortGapSeconds;
        const ms = durations.get(trackKey(s));
        return html`<tr data-row data-scrobble="${s.id}" tabindex="0">
          <td class="num muted">${offset + i + 1}</td>
          <td class="nowrap">${formatDate(s.ts, tz)}</td>
          <td class="nowrap mono">${formatTime(s.ts, tz)}</td>
          <td class="ellipsis" title="${s.artist}">${s.artist}</td>
          <td class="ellipsis strong" title="${s.track}">${s.track}</td>
          <td class="ellipsis muted" title="${s.album}">${s.album || '—'}</td>
          <td class="num nowrap ${short ? 'text-warning' : 'muted'}" ${short ? raw('title="Intervalo menor que o mínimo plausível"') : ''}>${s.gapPrev == null ? '—' : formatDuration(s.gapPrev)}</td>
          ${anyDuration ? html`<td class="num muted">${formatTrackLength(ms)}</td>` : ''}
          <td class="num">${fmtNum(playCounts.get(trackKey(s)))}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

function groupTable(list, group, tz) {
  const head = {
    track: html`<th>Música</th><th>Artista</th>`,
    artist: html`<th>Artista</th><th class="num">Músicas</th>`,
    album: html`<th>Álbum</th><th>Artista</th>`,
  }[group];
  return html`<table class="table">
    <thead><tr><th class="num">#</th>${head}<th class="num">Scrobbles</th><th>Primeiro</th><th>Último</th></tr></thead>
    <tbody>
      ${list.map((g, i) => {
        const attrs =
          group === 'track'
            ? html`data-track-key="${g.key}"`
            : group === 'artist'
              ? html`data-artist="${g.artist}"`
              : html`data-album="${g.album}" data-album-artist="${g.artist}"`;
        const cells = {
          track: html`<td class="ellipsis strong" title="${g.track}">${g.track}</td><td class="ellipsis" title="${g.artist}">${g.artist}</td>`,
          artist: html`<td class="ellipsis strong" title="${g.artist}">${g.artist}</td><td class="num">${fmtNum(new Set(g.items.map((s) => s.track.toLowerCase())).size)}</td>`,
          album: html`<td class="ellipsis strong" title="${g.album}">${g.album}</td><td class="ellipsis" title="${g.artist}">${g.artist}</td>`,
        }[group];
        return html`<tr data-row ${attrs} tabindex="0" title="${group === 'track' ? 'Ver todos os horários' : 'Filtrar'}">
          <td class="num muted">${i + 1}</td>${cells}
          <td class="num strong">${fmtNum(g.count)}</td>
          <td class="nowrap muted">${formatDateTime(g.firstTs, tz, { seconds: false })}</td>
          <td class="nowrap muted">${formatDateTime(g.lastTs, tz, { seconds: false })}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

function pagination(page, pages, pageSize, total) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return html`<nav class="pagination" aria-label="Paginação">
    <span class="muted small">${fmtNum(from)}–${fmtNum(to)} de ${fmtNum(total)}</span>
    <span class="spacer"></span>
    <label class="inline-field small">Por página
      <select data-role="page-size">${[25, 50, 100, 250, 500].map((n) => html`<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n}</option>`)}</select>
    </label>
    <button class="btn btn-sm btn-icon" data-page="1" ${page <= 1 ? 'disabled' : ''} aria-label="Primeira página">«</button>
    <button class="btn btn-sm btn-icon" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Página anterior">${icon('chevronLeft', 14)}</button>
    <span class="small">${fmtNum(page)} / ${fmtNum(pages)}</span>
    <button class="btn btn-sm btn-icon" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Próxima página">${icon('chevronRight', 14)}</button>
    <button class="btn btn-sm btn-icon" data-page="${pages}" ${page >= pages ? 'disabled' : ''} aria-label="Última página">»</button>
  </nav>`;
}

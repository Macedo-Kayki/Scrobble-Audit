import { html, $, on, icon, fmtNum } from '../dom.js';
import { openModal, confirmDialog, toast } from '../components/overlay.js';
import { columnChart } from '../components/charts.js';
import { trackKey } from '../../core/model.js';
import { AUDIT, APP, LASTFM } from '../../config.js';
import { friendlyMessage } from '../../core/errors.js';
import * as storage from '../../core/storage.js';
import { listSources } from '../../sources/registry.js';
import {
  formatDateTime, formatDate, formatTime, formatDuration, formatTrackLength, describeTimeZone, toIsoUtc, toIsoZoned,
  listTimeZones, browserTimeZone, localParts,
} from '../../core/time.js';

const WEEKDAYS_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const na = html`<span class="muted">não informado pela fonte</span>`;

function dl(rows) {
  return html`<dl class="dl">${rows.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

/* ---------- Detalhe de um scrobble ---------- */

export function openScrobble(app, id) {
  const s = app.store.get();
  const sc = s.audit?.scrobbles.find((x) => x.id === id);
  if (!sc) return;
  const tz = app.derived.timeZone();
  const auditTz = s.audit.range.timeZone;
  const ms = s.durations.get(trackKey(sc));
  const plays = app.derived.playCounts().get(trackKey(sc)) || 0;
  const p = localParts(sc.ts, tz);
  const short = (g) => (g != null && g < AUDIT.shortGapSeconds ? html` <span class="badge badge-warn">curto</span>` : '');
  const m = openModal({
    title: sc.track,
    subtitle: `${sc.artist}${sc.album ? ` — ${sc.album}` : ''}`,
    size: 'md',
    body: html`<div class="detail-head">
        ${sc.image ? html`<img class="cover" src="${sc.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
        <div>
          <div class="detail-time mono">${formatTime(sc.ts, tz)}</div>
          <div class="muted">${WEEKDAYS_FULL[p.weekday]}, ${formatDate(sc.ts, tz)} · ${describeTimeZone(tz, sc.ts)}</div>
        </div>
      </div>
      ${dl([
        ['Artista', sc.artist],
        ['Música', sc.track],
        ['Álbum', sc.album || na],
        ['Timestamp Unix', html`<code>${sc.ts}</code>`],
        ['UTC', html`<code>${toIsoUtc(sc.ts)}</code>`],
        ['Local', html`<code>${toIsoZoned(sc.ts, tz)}</code>`],
        auditTz !== tz && ['Timezone da auditoria', html`<code>${toIsoZoned(sc.ts, auditTz)}</code> (${auditTz})`],
        ['Desde o anterior', html`${sc.gapPrev == null ? '— (primeiro do intervalo)' : formatDuration(sc.gapPrev)}${short(sc.gapPrev)}`],
        ['Até o próximo', html`${sc.gapNext == null ? '— (último do intervalo)' : formatDuration(sc.gapNext)}${short(sc.gapNext)}`],
        ['Duração da faixa', ms != null ? formatTrackLength(ms) : s.durations.has(trackKey(sc)) ? na : html`<span class="muted">não consultada</span>`],
        ['Scrobbles desta música no período', fmtNum(plays)],
        ['MBID artista', sc.artistMbid ? html`<code>${sc.artistMbid}</code>` : na],
        ['MBID música', sc.trackMbid ? html`<code>${sc.trackMbid}</code>` : na],
        ['MBID álbum', sc.albumMbid ? html`<code>${sc.albumMbid}</code>` : na],
        ['Fonte', s.audit.sourceName],
        ['ID na auditoria', html`<code>${sc.id}</code>`],
      ])}`,
    footer: html`${sc.url ? html`<a class="btn btn-ghost" href="${sc.url}" target="_blank" rel="noopener">${icon('external', 14)} Abrir na ${s.audit.sourceName}</a>` : ''}
      <span class="spacer"></span>
      <button class="btn" data-act="artist">Filtrar artista</button>
      <button class="btn btn-primary" data-act="times">${icon('clock', 14)} Todos os horários desta música</button>`,
  });
  on(m.el, 'click', '[data-act]', (_e, b) => {
    if (b.dataset.act === 'times') {
      m.close();
      openTrackTimes(app, trackKey(sc));
    } else {
      app.actions.setFilters({ artist: sc.artist, exact: true });
      m.close();
    }
  });
}

/* ---------- Todos os horários de uma música ---------- */

export function openTrackTimes(app, key) {
  const s = app.store.get();
  if (!s.audit) return;
  const tz = app.derived.timeZone();
  const items = s.audit.scrobbles.filter((x) => trackKey(x) === key).sort((a, b) => a.ts - b.ts);
  if (!items.length) return;
  const first = items[0];
  const byHour = new Array(24).fill(0);
  const byDay = new Map();
  for (const it of items) {
    byHour[localParts(it.ts, tz).hour]++;
    const d = formatDate(it.ts, tz);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(it);
  }
  const gaps = items.slice(1).map((it, i) => it.ts - items[i].ts);
  const minGap = gaps.length ? Math.min(...gaps) : null;
  const m = openModal({
    title: first.track,
    subtitle: `${first.artist} · ${fmtNum(items.length)} scrobble(s) no intervalo auditado`,
    size: 'lg',
    body: html`<div class="tiles tiles-compact">
        <div class="tile"><span class="tile-label">Scrobbles</span><span class="tile-value">${fmtNum(items.length)}</span></div>
        <div class="tile"><span class="tile-label">Primeiro</span><span class="tile-value tile-value-sm">${formatDateTime(items[0].ts, tz)}</span></div>
        <div class="tile"><span class="tile-label">Último</span><span class="tile-value tile-value-sm">${formatDateTime(items[items.length - 1].ts, tz)}</span></div>
        <div class="tile"><span class="tile-label">Menor intervalo entre plays</span><span class="tile-value tile-value-sm">${minGap == null ? '—' : formatDuration(minGap)}</span></div>
      </div>
      <h3 class="section-title">Por hora do dia <span class="muted small">(${tz})</span></h3>
      ${columnChart({ data: byHour.map((v, h) => ({ label: `${String(h).padStart(2, '0')}h`, value: v })), ariaLabel: 'Plays desta música por hora do dia' })}
      <h3 class="section-title">Todos os horários</h3>
      <div class="times-list">
        ${[...byDay].map(
          ([day, list]) => html`<div class="times-day">
            <div class="times-day-head"><strong>${day}</strong> <span class="muted small">${fmtNum(list.length)}×</span></div>
            <div class="times-chips">${list.map((it) => html`<button type="button" class="time-chip mono" data-id="${it.id}" title="Unix ${it.ts}">${formatTime(it.ts, tz)}</button>`)}</div>
          </div>`,
        )}
      </div>`,
    footer: html`<button class="btn" data-act="filter">${icon('filter', 14)} Filtrar tabela por esta música</button>
      <span class="spacer"></span>
      <button class="btn" data-act="json">${icon('download', 14)} JSON</button>
      <button class="btn btn-primary" data-act="csv">${icon('download', 14)} CSV</button>`,
  });
  on(m.el, 'click', '[data-id]', (_e, b) => openScrobble(app, b.dataset.id));
  on(m.el, 'click', '[data-act]', (_e, b) => {
    const act = b.dataset.act;
    if (act === 'filter') {
      app.actions.setFilters({ artist: first.artist, track: first.track, exact: true });
      app.actions.setView({ group: 'none' });
      m.close();
    } else app.actions.exportScrobbles(items, `${first.artist}-${first.track}`, act);
  });
}

/* ---------- Detalhes da auditoria ---------- */

export function openAuditDetails(app) {
  const s = app.store.get();
  const a = s.audit;
  if (!a) return;
  const v = a.verification;
  const r = a.range;
  const statusLabel = { verified: 'Verificada', missing: 'Incompleta', extra: 'Divergente', imported: 'Importada (não reconsultada)' }[v.status] || v.status;
  const imp = a.imported;
  openModal({
    title: 'Detalhes da auditoria',
    subtitle: `${a.username} · ${a.sourceName}`,
    size: 'lg',
    body: html`<h3 class="section-title">Intervalo</h3>
      ${dl([
        ['Início (local)', html`${formatDateTime(r.from, r.timeZone)} <span class="muted">${r.timeZone}</span>`],
        ['Fim (local)', html`${formatDateTime(r.requestedTo ?? r.to, r.timeZone)} <span class="muted">${r.inclusiveEnd ? 'inclusivo' : 'exclusivo'}</span>`],
        ['Timezone', describeTimeZone(r.timeZone, r.from)],
        ['Início (UTC)', html`<code>${toIsoUtc(r.from)}</code>`],
        ['Fim efetivo (UTC)', html`<code>${toIsoUtc(r.to)}</code>`],
        ['Unix', html`<code>${r.from}</code> ≤ ts ≤ <code>${r.to}</code>`],
        ['Duração', formatDuration(r.to - r.from + 1)],
      ])}
      ${imp
        ? html`<h3 class="section-title">Importação</h3>
            ${dl([
              ['Arquivo', imp.fileName || '—'],
              ['Formato', imp.format.toUpperCase()],
              ['Conteúdo', imp.scope === 'filtered' ? 'resultado filtrado da auditoria original' : 'auditoria completa'],
              imp.filters && ['Filtros da exportação', html`<code>${JSON.stringify(imp.filters)}</code>`],
              ['Intervalo', imp.rangeDerived ? 'derivado do primeiro e do último scrobble (o arquivo não informa)' : 'informado pelo arquivo'],
              imp.exportedAt && ['Exportado em', new Date(imp.exportedAt).toLocaleString('pt-BR')],
              ['Importado em', new Date(imp.importedAt).toLocaleString('pt-BR')],
              v.original && ['Verificação na exportação', `${{ verified: 'verificada', missing: 'incompleta', extra: 'divergente' }[v.original.status] || v.original.status} (${fmtNum(v.original.fetchedInWindow)} de ${fmtNum(v.original.expected)})`],
            ])}
            <p class="hint">Os dados vêm do arquivo e não foram reconsultados na fonte. Use “Reauditar” para verificá-los agora.</p>`
        : ''}
      ${imp ? '' : html`<h3 class="section-title">Verificação</h3>
      ${dl([
        ['Status', html`<span class="badge ${v.status === 'verified' ? 'badge-ok' : 'badge-warn'}">${statusLabel}</span>`],
        ['Janela consultada na API', html`<code>from=${v.queryWindow?.from}</code> <code>to=${v.queryWindow?.to}</code> <span class="muted">(1s de folga em cada lado)</span>`],
        ['Total informado pela API (início)', fmtNum(v.initialExpected)],
        ['Total informado pela API (final)', fmtNum(v.expected)],
        ['Coletados na janela', fmtNum(v.fetchedInWindow)],
        ['Dentro do intervalo exato', fmtNum(a.scrobbles.length)],
        ['Mudou durante a auditoria', v.changedDuringAudit ? 'sim (novos scrobbles chegaram ou foram removidos)' : 'não'],
        ['Passadas de reconciliação', fmtNum(v.reconciliationPasses ?? 0)],
        v.nowPlayingSeen && ['“Tocando agora”', 'ignorado (não é um scrobble concluído)'],
      ])}`}
      <h3 class="section-title">Execução</h3>
      ${dl(
        imp
          ? [
              ['Fonte', `${a.sourceName} (${a.source})`],
              ['Auditoria original concluída em', new Date(a.finishedAt).toLocaleString('pt-BR')],
              a.requests > 0 && ['Requisições da auditoria original', fmtNum(a.requests)],
              ['Salva no navegador', s.auditPersisted === false ? 'não (excede a cota do localStorage)' : 'sim'],
            ]
          : [
              ['Fonte', `${a.sourceName} (${a.source})`],
              ['Iniciada', new Date(a.startedAt).toLocaleString('pt-BR')],
              ['Concluída', new Date(a.finishedAt).toLocaleString('pt-BR')],
              ['Tempo total', formatDuration(a.durationMs / 1000)],
              ['Requisições', fmtNum(a.requests)],
              ['Retentativas', fmtNum(a.retries)],
              ['Salva no navegador', s.auditPersisted === false ? 'não (excede a cota do localStorage)' : 'sim'],
            ],
      )}
      <h3 class="section-title">Método</h3>
      <ul class="method">
        <li>A API é consultada com 1 segundo de folga e o intervalo exato é aplicado localmente, independentemente de a API tratar <code>from</code>/<code>to</code> como inclusivos ou exclusivos.</li>
        <li>A paginação usa cursor de tempo (<code>to</code> = scrobble mais antigo já visto), em vez de número de página: scrobbles que chegam durante a auditoria não deslocam as páginas.</li>
        <li>O segundo de fronteira é relido e deduplicado preservando duplicatas legítimas (mesma música no mesmo segundo).</li>
        <li>Ao final, a contagem é conferida com o total oficial da API; se faltar algo, a janela é percorrida de novo.</li>
        <li>Faixas “tocando agora” são ignoradas. Campos que a API não fornece aparecem vazios — nada é inferido.</li>
      </ul>`,
  });
}

/* ---------- Configurações ---------- */

export function openSettings(app) {
  const s = app.store.get();
  const st = s.settings;
  const zones = listTimeZones();
  const usage = storage.usageBytes();
  const m = openModal({
    title: 'Configurações',
    size: 'md',
    body: html`<form class="settings" id="settings-form">
      <label class="field">
        <span class="field-label">Fonte de scrobbles</span>
        <select name="source">${listSources().map((src) => html`<option value="${src.id}" ${src.id === st.source ? 'selected' : ''}>${src.name}</option>`)}</select>
      </label>
      ${LASTFM.proxyUrl
        ? html`<p class="proxy-note">${icon('check', 14)} Esta instância usa um proxy: a API key fica no servidor e não é exposta ao navegador. Não é preciso informar key.</p>`
        : ''}
      <label class="field">
        <span class="field-label">API key própria da Last.fm ${LASTFM.proxyUrl ? html`<span class="muted small">(opcional — substitui o proxy)</span>` : ''}</span>
        <span class="input-group">
          <input name="apiKey" type="password" autocomplete="off" spellcheck="false" value="${st.apiKey}" placeholder="32 caracteres hexadecimais" autofocus />
          <button type="button" class="btn btn-icon" data-act="toggle-key" aria-label="Mostrar/ocultar">${icon('eye', 16)}</button>
          <button type="button" class="btn" data-act="test-key">Testar</button>
        </span>
        <span class="hint">Obtenha em <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener">last.fm/api/account/create</a>. Uma key digitada aqui fica salva só neste navegador e é visível a quem o usa; para escondê-la de verdade, use o proxy.</span>
        <span class="hint" id="key-test" aria-live="polite"></span>
      </label>
      <label class="field">
        <span class="field-label">Timezone padrão</span>
        <select name="timeZone">
          <option value="">Navegador — ${browserTimeZone()}</option>
          ${zones.map((z) => html`<option value="${z}" ${z === st.timeZone ? 'selected' : ''}>${z}</option>`)}
        </select>
        <span class="hint">Usado para interpretar o intervalo digitado e exibir todos os horários.</span>
      </label>
      <label class="check"><input type="checkbox" name="inclusiveEnd" ${st.inclusiveEnd ? 'checked' : ''} /> Fim do intervalo inclusivo <span class="muted small">(08:00–13:00 inclui scrobbles às 13:00:00)</span></label>
      <div class="row-2">
        <label class="field">
          <span class="field-label">Separador do CSV</span>
          <select name="csvDelimiter">
            <option value="," ${st.csvDelimiter === ',' ? 'selected' : ''}>Vírgula (,)</option>
            <option value=";" ${st.csvDelimiter === ';' ? 'selected' : ''}>Ponto e vírgula (;) — Excel pt-BR</option>
            <option value="&#9;" ${st.csvDelimiter === '\t' ? 'selected' : ''}>Tab</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Tema</span>
          <select name="theme">
            ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => html`<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`)}
          </select>
        </label>
      </div>
      <div class="storage-box">
        <div><strong>Dados locais</strong><p class="muted small">${fmtNum(Math.round(usage / 1024))} KB usados no localStorage (configurações, histórico, ranking, última auditoria e cache de durações).</p></div>
        <button type="button" class="btn btn-danger btn-sm" data-act="clear">${icon('trash', 14)} Apagar tudo</button>
      </div>
      <p class="muted small">${APP.name} v${APP.version} · 100% frontend · nenhum dado sai do seu navegador além das chamadas à API da fonte.</p>
    </form>`,
    footer: html`<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-act="save">Salvar</button>`,
  });
  const form = $('#settings-form', m.el);
  const save = () => {
    const f = form.elements;
    app.actions.setSettings({
      source: f.source.value,
      apiKey: f.apiKey.value.trim(),
      timeZone: f.timeZone.value,
      inclusiveEnd: f.inclusiveEnd.checked,
      csvDelimiter: f.csvDelimiter.value,
      theme: f.theme.value,
    });
    toast('Configurações salvas.', 'success');
    m.close();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  on(m.el, 'click', '[data-act]', async (_e, b) => {
    const act = b.dataset.act;
    if (act === 'save') save();
    else if (act === 'toggle-key') form.elements.apiKey.type = form.elements.apiKey.type === 'password' ? 'text' : 'password';
    else if (act === 'test-key') {
      const out = $('#key-test', m.el);
      const key = form.elements.apiKey.value.trim();
      if (!key) return (out.textContent = 'Informe a key.');
      out.textContent = 'Testando…';
      try {
        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=rj&api_key=${encodeURIComponent(key)}&format=json`);
        const body = await res.json();
        out.textContent = body.error ? `Falhou: ${body.message}` : '✓ Key válida.';
      } catch (e) {
        out.textContent = `Falhou: ${friendlyMessage(e)}`;
      }
    } else if (act === 'clear') {
      const ok = await confirmDialog({
        title: 'Apagar dados locais',
        message: 'Remove API key, histórico, ranking, filtros, última auditoria e cache de durações deste navegador. Não pode ser desfeito.',
        confirmLabel: 'Apagar tudo',
        danger: true,
      });
      if (ok) app.actions.clearAllData();
    }
  });
}

/* ---------- Detalhe de um usuário do ranking ---------- */

export function openRankingEntry(app, username) {
  const s = app.store.get();
  const e = s.ranking.entries.find((x) => x.username.toLowerCase() === username.toLowerCase());
  if (!e) return;
  const tz = app.derived.timeZone();
  const list = (rows, fmt) => (rows?.length ? html`<ol class="plain-list">${rows.map((r) => html`<li><span>${fmt(r)}</span><span class="muted">${fmtNum(r.count)}</span></li>`)}</ol>` : html`<p class="muted">—</p>`);
  const m = openModal({
    title: e.username,
    subtitle: 'Resumo no intervalo do ranking',
    size: 'md',
    body: html`${dl([
        ['Scrobbles', fmtNum(e.total)],
        ['Músicas únicas', fmtNum(e.uniqueTracks)],
        ['Artistas únicos', fmtNum(e.uniqueArtists)],
        ['Primeiro scrobble', e.first ? formatDateTime(e.first, tz) : '—'],
        ['Último scrobble', e.last ? formatDateTime(e.last, tz) : '—'],
        ['Intervalos < ' + AUDIT.shortGapSeconds + 's', fmtNum(e.shortGaps)],
        ['Verificação', e.verification ? `${e.verification.status} (${fmtNum(e.verification.fetchedInWindow)}/${fmtNum(e.verification.expected)})` : '—'],
        ['Auditado em', new Date(e.auditedAt).toLocaleString('pt-BR')],
      ])}
      <div class="row-2">
        <div><h3 class="section-title">Top artistas</h3>${list(e.topArtists, (r) => r.artist)}</div>
        <div><h3 class="section-title">Top músicas</h3>${list(e.topTracks, (r) => `${r.track} — ${r.artist}`)}</div>
      </div>`,
    footer: html`<span class="spacer"></span><button class="btn btn-primary" data-act="open">${icon('search', 14)} Abrir auditoria completa</button>`,
  });
  on(m.el, 'click', '[data-act="open"]', () => {
    m.close();
    app.actions.openInAudit(e.username);
  });
}


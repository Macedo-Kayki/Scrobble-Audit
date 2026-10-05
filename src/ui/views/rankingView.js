import { html, setHtml, $, $$, on, icon, fmtNum, debounce } from '../dom.js';
import { confirmDialog } from '../components/overlay.js';
import { rangeKey } from '../../core/audit.js';
import { formatDateTime, formatSpan } from '../../core/time.js';
import { applyRankingFilter, hasRankingFilter, describeRankingFilter } from '../../core/rankingFilter.js';
import { TIME_ZONE } from '../../config.js';
import { rankingRows } from '../app.js';
import * as modals from './modals.js';
import { pickFile } from '../components/filePicker.js';

const PRESETS = [
  ['today', 'Hoje'],
  ['yesterday', 'Ontem'],
  ['last7d', 'Últimos 7 dias'],
  ['thisMonth', 'Este mês'],
  ['lastMonth', 'Mês passado'],
];

const PHASES = { user: 'procurando o usuário', probe: 'contando', fetch: 'buscando', verify: 'conferindo', reconcile: 'buscando o que faltou', done: 'finalizando' };
const STATUS = {
  verified: { cls: 'badge-ok', ic: 'check', label: 'conferido' },
  missing: { cls: 'badge-warn', ic: 'alert', label: 'faltaram scrobbles' },
  extra: { cls: 'badge-warn', ic: 'alert', label: 'o total mudou' },
  imported: { cls: 'badge-neutral', ic: 'upload', label: 'de arquivo' },
};

/**
 * A tela tem três partes que se redesenham de forma independente, para que
 * digitar no período, no nome ou no filtro nunca apague o que está sendo digitado:
 * cabeçalho (período, adicionar, ações), barra de filtro e lista.
 */
export function mountRankingView(root, app) {
  const { store } = app;
  setHtml(root, html`<div id="rk-head"></div><div id="rk-filter"></div><div id="rk-list"></div>`);
  const head = $('#rk-head', root);
  const filterBar = $('#rk-filter', root);
  const list = $('#rk-list', root);
  renderFilterBar(filterBar, app);
  bind(root, app);

  const update = (s, p) => {
    const formChanged = !p || s.rankingForm.rev !== p.rankingForm.rev || s.rankingForm.editing !== p.rankingForm.editing;
    const dataChanged = !p || s.ranking !== p.ranking || s.rankingJob !== p.rankingJob;
    if (formChanged || dataChanged || s.settings !== p.settings || s.audit !== p.audit) renderHead(head, s);
    if (dataChanged || s.rankingFilter !== p.rankingFilter) {
      syncFilterBar(filterBar, s);
      renderList(list, s);
    }
  };
  store.subscribe(update);
  update(store.get(), null);
}

function bind(root, app) {
  const { actions } = app;
  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'ranking-add') return;
    e.preventDefault();
    actions.addRankingUser(e.target.elements.username.value);
  });
  // Período e nome: guardam o que é digitado no estado, sem redesenhar.
  root.addEventListener('input', (e) => {
    const field = e.target.dataset?.rf;
    if (field) actions.setRankingForm({ [field]: e.target.value });
  });
  on(root, 'click', '[data-action]', async (_e, b) => {
    const a = b.dataset.action;
    const user = b.dataset.user;
    if (a === 'copy-audit-period') actions.copyAuditPeriodToRanking();
    else if (a === 'preset') actions.rankingPreset(b.dataset.preset);
    else if (a === 'edit-period') actions.editRankingPeriod(true);
    else if (a === 'cancel-period') actions.editRankingPeriod(false);
    else if (a === 'save-period') actions.saveRankingPeriod();
    else if (a === 'refresh-all') actions.refreshAllRanking();
    else if (a === 'cancel') actions.cancelRanking();
    else if (a === 'refresh') actions.auditRankingUser(user, { force: true });
    else if (a === 'details') modals.openRankingEntry(app, user);
    else if (a === 'open') {
      // Com filtro ativo, a auditoria abre já filtrada pelo mesmo artista/música/álbum.
      const f = app.store.get().rankingFilter;
      if (hasRankingFilter(f)) actions.setFilters({ artist: f.artist, track: f.track, album: f.album, exact: f.exact });
      actions.openInAudit(user);
    }
    else if (a === 'clear-rank-filter') actions.clearRankingFilter();
    else if (a === 'export') {
      actions.exportRanking(b.dataset.format);
      b.closest('details')?.removeAttribute('open');
    } else if (a === 'remove') {
      if (await confirmDialog({ title: 'Tirar do ranking', message: `Tirar ${user} do ranking?`, confirmLabel: 'Tirar', danger: true })) actions.removeFromRanking(user);
    } else if (a === 'clear') {
      if (await confirmDialog({ title: 'Limpar ranking', message: 'Isso tira todos os usuários e o período do ranking.', confirmLabel: 'Limpar', danger: true })) actions.clearRanking();
    } else if (a === 'add-current') actions.addCurrentAuditToRanking();
    else if (a === 'import') actions.importFile(await pickFile());
  });
}

/* ---------------- Cabeçalho ---------------- */

function renderHead(el, s) {
  const r = s.ranking;
  const job = s.rankingJob;
  const { current } = rankingRows(r);
  const rf = s.rankingForm;
  const canAddCurrent = s.audit && !r.entries.some((e) => e.username.toLowerCase() === s.audit.username.toLowerCase() && e.rangeKey === (r.range && rangeKey(r.range)));
  const dis = job ? 'disabled' : '';
  const end = r.range ? r.range.requestedTo ?? r.range.to : null;
  const showEditor = !r.range || rf.editing;

  setHtml(
    el,
    html`<section class="card ranking-head">
      <div class="ranking-title">
        <h2 class="card-title">${icon('trophy', 18)} Ranking</h2>
        <p class="muted small">Compare quantos scrobbles cada pessoa fez no mesmo período.</p>
      </div>

      ${showEditor
        ? html`<fieldset class="ranking-period" ${dis}>
            <legend>${r.range ? 'Mudar o período' : '1. Escolha o período'}</legend>
            <div class="row-2">
              <label class="field"><span class="field-label">De</span><input type="datetime-local" step="1" data-rf="start" value="${rf.start || ''}" /></label>
              <label class="field"><span class="field-label">Até</span><input type="datetime-local" step="1" data-rf="end" value="${rf.end || ''}" /></label>
            </div>
            <div class="chips">
              ${PRESETS.map(([id, label]) => html`<button type="button" class="chip" data-action="preset" data-preset="${id}">${label}</button>`)}
              <button type="button" class="chip" data-action="copy-audit-period" title="Usar o mesmo período preenchido na aba Auditoria">Igual à aba Auditoria</button>
            </div>
            ${r.range
              ? html`<div class="ranking-period-actions">
                  <button type="button" class="btn btn-sm btn-primary" data-action="save-period">Salvar período</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-action="cancel-period">Cancelar</button>
                </div>`
              : ''}
          </fieldset>`
        : html`<div class="ranking-range-line">
            <p class="ranking-range">${icon('clock', 14)} De <strong>${formatDateTime(r.range.from, TIME_ZONE)}</strong> até <strong>${formatDateTime(end, TIME_ZONE)}</strong> <span class="muted">(${formatSpan(end - r.range.from)})</span></p>
            <button type="button" class="btn btn-sm" data-action="edit-period" ${dis}>${icon('clock', 14)} Mudar período</button>
          </div>`}

      <form id="ranking-add" class="ranking-add">
        ${!r.range ? html`<span class="field-label ranking-step">2. Digite quem você quer comparar</span>` : ''}
        <div class="ranking-add-row">
          <span class="input-icon">${icon('user', 16)}<input name="username" data-rf="username" value="${rf.username || ''}" placeholder="nome de usuário da Last.fm" aria-label="Usuário para colocar no ranking" autocomplete="off" autocapitalize="off" spellcheck="false" list="user-history" ${dis} /></span>
          <button class="btn btn-primary" type="submit" ${dis}>${icon('plus', 16)} Colocar no ranking</button>
        </div>
      </form>

      ${canAddCurrent || r.entries.length || current.length || r.range
        ? html`<div class="ranking-actions">
            ${canAddCurrent ? html`<button class="btn btn-sm" data-action="add-current" ${dis}>${icon('plus', 14)} Colocar ${s.audit.username} (auditoria atual)</button>` : ''}
            ${r.entries.length ? html`<button class="btn btn-sm" data-action="refresh-all" ${dis}>${icon('refresh', 14)} Atualizar todos</button>` : ''}
            ${current.length
              ? html`<details class="dropdown">
                  <summary class="btn btn-sm">${icon('download', 14)} Exportar</summary>
                  <div class="dropdown-menu">
                    <button type="button" data-action="export" data-format="csv">Planilha (abre no Excel)</button>
                    <button type="button" data-action="export" data-format="json">Arquivo para abrir aqui depois</button>
                  </div>
                </details>`
              : ''}
            <button class="btn btn-sm" data-action="import" ${dis} title="Abrir um ranking que você exportou antes">${icon('upload', 14)} Importar</button>
            ${r.range || r.entries.length ? html`<button class="btn btn-sm btn-ghost" data-action="clear" ${dis}>${icon('trash', 14)} Limpar</button>` : ''}
          </div>`
        : html`<p class="muted small">Tem um ranking salvo? <button type="button" class="link-inline" data-action="import">Abra o arquivo</button>.</p>`}

      ${job
        ? html`<div class="ranking-job">
            <span class="spinner spinner-sm"></span>
            <span>Auditando <strong>${job.username}</strong>${job.count ? ` (${job.index} de ${job.count})` : ''} — ${PHASES[job.progress?.phase] || 'começando'}${job.progress?.expected ? ` ${fmtNum(job.progress.fetched)} de ${fmtNum(job.progress.expected)}` : ''}</span>
            <button class="btn btn-sm" data-action="cancel">Cancelar</button>
          </div>`
        : ''}
    </section>`,
  );
}

/* ---------------- Barra de filtro ---------------- */

function renderFilterBar(el, app) {
  setHtml(
    el,
    html`<section class="card rank-filter" aria-label="Filtrar ranking">
      <div class="rank-filter-head">
        <span class="card-title">${icon('filter', 16)} Filtrar ranking</span>
        <span class="muted small">Veja quem mais ouviu um artista, uma música ou um álbum.</span>
      </div>
      <div class="rank-filter-grid">
        <label class="field"><span class="field-label">Artista</span><input type="search" data-rkf="artist" autocomplete="off" /></label>
        <label class="field"><span class="field-label">Música</span><input type="search" data-rkf="track" autocomplete="off" /></label>
        <label class="field"><span class="field-label">Álbum</span><input type="search" data-rkf="album" autocomplete="off" /></label>
      </div>
      <div class="rank-filter-foot">
        <label class="check"><input type="checkbox" data-rkf="exact" /> Só o nome exato <span class="muted small">(sem contar maiúsculas e acentos)</span></label>
        <button type="button" class="btn btn-sm btn-ghost" data-action="clear-rank-filter" hidden>${icon('x', 14)} Limpar filtro</button>
      </div>
    </section>`,
  );
  const push = debounce((patch) => app.actions.setRankingFilter(patch), 180);
  el.addEventListener('input', (e) => {
    const k = e.target.dataset?.rkf;
    if (!k) return;
    if (e.target.type === 'checkbox') app.actions.setRankingFilter({ [k]: e.target.checked });
    else push({ [k]: e.target.value });
  });
}

function syncFilterBar(el, s) {
  const { current } = rankingRows(s.ranking);
  el.hidden = current.length < 1;
  const f = s.rankingFilter;
  for (const input of $$('[data-rkf]', el)) {
    const k = input.dataset.rkf;
    if (input.type === 'checkbox') input.checked = Boolean(f[k]);
    else if (document.activeElement !== input && input.value !== (f[k] || '')) input.value = f[k] || '';
  }
  $('[data-action="clear-rank-filter"]', el).hidden = !hasRankingFilter(f);
}

/* ---------------- Lista ---------------- */

function renderList(el, s) {
  const r = s.ranking;
  const job = s.rankingJob;
  const { current, stale } = rankingRows(r);
  const dis = job ? 'disabled' : '';
  const filter = s.rankingFilter;
  const filtering = hasRankingFilter(filter);

  // Com filtro: cada linha passa a valer o total filtrado e a lista é reordenada.
  let rows = current.map((e) => ({ e, view: null }));
  if (filtering) {
    rows = current.map((e) => ({ e, view: applyRankingFilter(e, filter) }));
    rows.sort((a, b) => (b.view ? b.view.total : -1) - (a.view ? a.view.total : -1) || a.e.username.localeCompare(b.e.username));
  }
  const valueOf = (row) => (filtering ? row.view?.total ?? null : row.e.total);
  const max = Math.max(0, ...rows.map((row) => valueOf(row) ?? 0));
  const missing = filtering ? rows.filter((row) => !row.view).length : 0;

  setHtml(
    el,
    html`${current.length
        ? html`<section class="card rank-card">
            ${filtering
              ? html`<div class="rank-filter-note">
                  ${icon('filter', 14)} <span>Mostrando só os scrobbles de ${describeRankingFilter(filter)}.</span>
                  ${missing ? html`<span class="text-warning">${missing} pessoa(s) precisam ser atualizadas para entrar no filtro.</span>` : ''}
                </div>`
              : ''}
            <ol class="rank-list">${rows.map((row, i) => rankRow(row, i + 1, max, job, filtering))}</ol>
          </section>`
        : r.range
          ? html`<div class="empty-state small-empty">${icon('trophy', 32)}<p class="muted">Digite um nome de usuário acima para começar a comparar.</p></div>`
          : ''}

      ${stale.length
        ? html`<section class="card stale">
            <h3 class="card-title">${icon('alert', 16)} Auditados em outro período</h3>
            <p class="muted small">Estes não entram na comparação até serem auditados de novo no período atual.</p>
            <ul class="stale-list">
              ${stale.map(
                (e) => html`<li>
                  <strong>${e.username}</strong> <span class="muted small">${fmtNum(e.total)} scrobbles em outro período</span>
                  <span class="spacer"></span>
                  <button class="btn btn-sm" data-action="refresh" data-user="${e.username}" ${dis}>${icon('refresh', 14)} Auditar neste período</button>
                  <button class="btn btn-sm btn-ghost" data-action="remove" data-user="${e.username}">${icon('trash', 14)} Tirar</button>
                </li>`,
              )}
            </ul>
          </section>`
        : ''}`,
  );
}

function rankRow({ e, view }, pos, max, job, filtering) {
  const st = STATUS[e.verification?.status] || null;
  const cantFilter = filtering && !view;
  const value = filtering ? view?.total ?? 0 : e.total;
  const pct = max && !cantFilter ? (value / max) * 100 : 0;
  const src = filtering ? view : e;
  const meta = cantFilter
    ? ['Esta pessoa foi auditada antes do filtro existir. Clique em “Atualizar” para incluí-la.']
    : [
        src?.uniqueTracks != null && `${fmtNum(src.uniqueTracks)} música(s)`,
        !filtering && src?.uniqueArtists != null && `${fmtNum(src.uniqueArtists)} artistas`,
        filtering && src?.topTrack && `mais ouvida: ${src.topTrack.track}`,
        !filtering && src?.topArtist && `mais ouvido: ${src.topArtist.artist}`,
      ].filter(Boolean);
  const sub = filtering ? (cantFilter ? 'sem dados para o filtro' : `de ${fmtNum(e.total)} no total`) : `scrobbles${pos > 1 && max ? ` · ${Math.round(pct)}% do 1º` : ''}`;
  return html`<li class="rank-row ${cantFilter ? 'rank-row-muted' : ''}">
    ${cantFilter ? html`<span class="rank rank-n" aria-hidden="true">–</span>` : html`<span class="rank rank-${pos <= 3 && value > 0 ? pos : 'n'}" aria-label="${pos}º lugar">${pos}</span>`}
    <div class="rank-main">
      <div class="rank-name-line">
        <button type="button" class="link rank-name" data-action="details" data-user="${e.username}" title="Ver resumo">${e.username}</button>
        ${st ? html`<span class="badge ${st.cls}">${icon(st.ic, 12)} ${st.label}</span>` : ''}
      </div>
      <div class="rank-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="rank-meta muted small">${meta.join(' · ')}${!filtering && e.auditedAt ? html`<span class="rank-date"> · auditado em ${new Date(e.auditedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}</div>
    </div>
    <div class="rank-total">
      <strong>${cantFilter ? '—' : fmtNum(value)}</strong>
      <span class="muted small">${sub}</span>
    </div>
    <div class="rank-actions">
      <button type="button" class="btn btn-sm" data-action="open" data-user="${e.username}" title="Abrir a auditoria completa de ${e.username}">${icon('search', 14)} Ver</button>
      <button type="button" class="btn btn-sm ${cantFilter ? 'btn-primary-soft' : ''}" data-action="refresh" data-user="${e.username}" ${job ? 'disabled' : ''} title="Auditar ${e.username} de novo">${icon('refresh', 14)} Atualizar</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="remove" data-user="${e.username}" title="Tirar ${e.username} do ranking">${icon('trash', 14)} Tirar</button>
    </div>
  </li>`;
}

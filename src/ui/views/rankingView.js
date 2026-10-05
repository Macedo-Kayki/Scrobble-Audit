import { html, setHtml, on, icon, fmtNum } from '../dom.js';
import { confirmDialog } from '../components/overlay.js';
import { buildRange, rangeKey } from '../../core/audit.js';
import { formatDateTime, formatSpan } from '../../core/time.js';
import { TIME_ZONE } from '../../config.js';
import { rankingRows } from '../app.js';
import * as modals from './modals.js';
import { pickFile } from '../components/filePicker.js';

const PHASES = { user: 'procurando o usuário', probe: 'contando', fetch: 'buscando', verify: 'conferindo', reconcile: 'buscando o que faltou', done: 'finalizando' };
const STATUS = {
  verified: { cls: 'badge-ok', ic: 'check', label: 'conferido' },
  missing: { cls: 'badge-warn', ic: 'alert', label: 'faltaram scrobbles' },
  extra: { cls: 'badge-warn', ic: 'alert', label: 'o total mudou' },
  imported: { cls: 'badge-neutral', ic: 'upload', label: 'de arquivo' },
};

export function mountRankingView(root, app) {
  const { store } = app;
  bind(root, app);
  const update = (s, p) => {
    if (p && s.ranking === p.ranking && s.rankingJob === p.rankingJob && s.form === p.form && s.settings === p.settings && s.audit === p.audit) return;
    render(root, s, app);
  };
  store.subscribe(update);
  update(store.get(), null);
}

function bind(root, app) {
  const { actions } = app;
  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'ranking-add') return;
    e.preventDefault();
    const input = e.target.elements.username;
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    actions.auditRankingUser(name);
  });
  on(root, 'click', '[data-action]', async (_e, b) => {
    const a = b.dataset.action;
    const user = b.dataset.user;
    if (a === 'use-form-range') actions.setRankingRangeFromForm();
    else if (a === 'refresh-all') actions.refreshAllRanking();
    else if (a === 'cancel') actions.cancelRanking();
    else if (a === 'refresh') actions.auditRankingUser(user);
    else if (a === 'details') modals.openRankingEntry(app, user);
    else if (a === 'open') actions.openInAudit(user);
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

function render(root, s, app) {
  const r = s.ranking;
  const job = s.rankingJob;
  const { current, stale } = rankingRows(r);
  let formRangeKey = null;
  try {
    formRangeKey = rangeKey(buildRange({ startInput: s.form.start, endInput: s.form.end, timeZone: TIME_ZONE, inclusiveEnd: s.settings.inclusiveEnd }));
  } catch {
    /* formulário incompleto */
  }
  const formDiffers = r.range && formRangeKey && formRangeKey !== rangeKey(r.range);
  const canAddCurrent = s.audit && !r.entries.some((e) => e.username.toLowerCase() === s.audit.username.toLowerCase() && e.rangeKey === (r.range && rangeKey(r.range)));
  const dis = job ? 'disabled' : '';
  const end = r.range ? r.range.requestedTo ?? r.range.to : null;

  setHtml(
    root,
    html`<section class="card ranking-head">
        <div class="ranking-title">
          <h2 class="card-title">${icon('trophy', 18)} Ranking</h2>
          <p class="muted small">Compare quantos scrobbles cada pessoa fez no mesmo período.</p>
        </div>
        ${r.range
          ? html`<p class="ranking-range">${icon('clock', 14)} De <strong>${formatDateTime(r.range.from, TIME_ZONE)}</strong> até <strong>${formatDateTime(end, TIME_ZONE)}</strong> <span class="muted">(${formatSpan(end - r.range.from)})</span></p>`
          : html`<p class="muted">Escolha o período na aba <strong>Auditoria</strong> e clique em “Usar o período da aba Auditoria”, ou coloque no ranking uma auditoria que você já fez.</p>`}
        <div class="ranking-actions">
          ${!r.range || formDiffers
            ? html`<button class="btn btn-sm" data-action="use-form-range" ${dis}>${icon('clock', 14)} ${r.range ? 'Trocar pelo período da aba Auditoria' : 'Usar o período da aba Auditoria'}</button>`
            : ''}
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
        </div>
        ${r.range
          ? html`<form id="ranking-add" class="ranking-add">
              <span class="input-icon">${icon('user', 16)}<input name="username" placeholder="nome de usuário da Last.fm" aria-label="Usuário para colocar no ranking" autocomplete="off" autocapitalize="off" spellcheck="false" list="user-history" ${dis} /></span>
              <button class="btn btn-primary" type="submit" ${dis}>${icon('plus', 16)} Colocar no ranking</button>
            </form>`
          : ''}
        ${job
          ? html`<div class="ranking-job">
              <span class="spinner spinner-sm"></span>
              <span>Auditando <strong>${job.username}</strong>${job.count ? ` (${job.index} de ${job.count})` : ''} — ${PHASES[job.progress?.phase] || 'começando'}${job.progress?.expected ? ` ${fmtNum(job.progress.fetched)} de ${fmtNum(job.progress.expected)}` : ''}</span>
              <button class="btn btn-sm" data-action="cancel">Cancelar</button>
            </div>`
          : ''}
      </section>

      ${current.length
        ? html`<section class="card rank-card">
            <ol class="rank-list">${current.map((e, i) => rankRow(e, i + 1, current[0].total, job))}</ol>
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

function rankRow(e, pos, max, job) {
  const st = STATUS[e.verification?.status] || null;
  const pct = max ? (e.total / max) * 100 : 0;
  const meta = [
    e.uniqueTracks != null && `${fmtNum(e.uniqueTracks)} músicas`,
    e.uniqueArtists != null && `${fmtNum(e.uniqueArtists)} artistas`,
    e.topArtist && `mais ouvido: ${e.topArtist.artist}`,
  ].filter(Boolean);
  return html`<li class="rank-row">
    <span class="rank rank-${pos <= 3 ? pos : 'n'}" aria-label="${pos}º lugar">${pos}</span>
    <div class="rank-main">
      <div class="rank-name-line">
        <button type="button" class="link rank-name" data-action="details" data-user="${e.username}" title="Ver resumo">${e.username}</button>
        ${st ? html`<span class="badge ${st.cls}">${icon(st.ic, 12)} ${st.label}</span>` : ''}
      </div>
      <div class="rank-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="rank-meta muted small">${meta.join(' · ')}${e.auditedAt ? html`<span class="rank-date"> · auditado em ${new Date(e.auditedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}</div>
    </div>
    <div class="rank-total">
      <strong>${fmtNum(e.total)}</strong>
      <span class="muted small">scrobbles${pos > 1 && max ? ` · ${Math.round(pct)}% do 1º` : ''}</span>
    </div>
    <div class="rank-actions">
      <button type="button" class="btn btn-sm" data-action="open" data-user="${e.username}" title="Abrir a auditoria completa de ${e.username}">${icon('search', 14)} Ver</button>
      <button type="button" class="btn btn-sm" data-action="refresh" data-user="${e.username}" ${job ? 'disabled' : ''} title="Auditar ${e.username} de novo">${icon('refresh', 14)} Atualizar</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="remove" data-user="${e.username}" title="Tirar ${e.username} do ranking">${icon('trash', 14)} Tirar</button>
    </div>
  </li>`;
}

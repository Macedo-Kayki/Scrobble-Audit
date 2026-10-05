import { html, setHtml, $, on, icon, fmtNum } from '../dom.js';
import { barList } from '../components/charts.js';
import { confirmDialog } from '../components/overlay.js';
import { buildRange, rangeKey } from '../../core/audit.js';
import { formatDateTime, describeTimeZone, formatDuration } from '../../core/time.js';
import { rankingRows } from '../app.js';
import * as modals from './modals.js';
import { pickFile } from '../components/filePicker.js';

const PHASES = { user: 'validando usuário', probe: 'consultando total', fetch: 'baixando', verify: 'verificando', reconcile: 'reconciliando', done: 'finalizando' };

export function mountRankingView(root, app) {
  const { store, actions } = app;
  bind(root, app);
  const update = (s, p) => {
    if (p && s.ranking === p.ranking && s.rankingJob === p.rankingJob && s.form === p.form && s.settings === p.settings && s.audit === p.audit) return;
    render(root, s, app);
  };
  store.subscribe(update);
  update(store.get(), null);
}

function bind(root, app) {
  const { actions, store } = app;
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
    else if (a === 'details') modals.openRankingEntry(app, user || b.dataset.key);
    else if (a === 'open') actions.openInAudit(user);
    else if (a === 'export') actions.exportRanking(b.dataset.format);
    else if (a === 'remove') {
      if (await confirmDialog({ title: 'Remover do ranking', message: `Remover ${user} do ranking?`, confirmLabel: 'Remover', danger: true })) actions.removeFromRanking(user);
    } else if (a === 'clear') {
      if (await confirmDialog({ title: 'Limpar ranking', message: 'Remove todos os usuários e o intervalo do ranking.', confirmLabel: 'Limpar', danger: true })) actions.clearRanking();
    } else if (a === 'add-current') actions.addCurrentAuditToRanking();
    else if (a === 'import') actions.importFile(await pickFile());
  });
}

function render(root, s, app) {
  const r = s.ranking;
  const tz = app.derived.timeZone();
  const job = s.rankingJob;
  const { current, stale } = rankingRows(r);
  let formRangeKey = null;
  try {
    formRangeKey = rangeKey(buildRange({ startInput: s.form.start, endInput: s.form.end, timeZone: tz, inclusiveEnd: s.settings.inclusiveEnd }));
  } catch {
    /* formulário inválido */
  }
  const formDiffers = r.range && formRangeKey && formRangeKey !== rangeKey(r.range);
  const canAddCurrent = s.audit && !r.entries.some((e) => e.username.toLowerCase() === s.audit.username.toLowerCase() && e.rangeKey === (r.range && rangeKey(r.range)));

  setHtml(
    root,
    html`<section class="card ranking-head">
        <div class="ranking-title">
          <h2 class="card-title">${icon('trophy', 18)} Ranking de usuários auditados</h2>
          <p class="muted small">Todos os usuários são comparados exatamente no mesmo intervalo de timestamps.</p>
        </div>
        ${r.range
          ? html`<div class="ranking-range">
              <span class="badge badge-neutral">Intervalo</span>
              <strong>${formatDateTime(r.range.from, r.range.timeZone)} → ${formatDateTime(r.range.requestedTo ?? r.range.to, r.range.timeZone)}</strong>
              <span class="muted small">${describeTimeZone(r.range.timeZone, r.range.from)} · ${formatDuration(r.range.to - r.range.from + 1)} · Unix ${r.range.from}–${r.range.to}</span>
            </div>`
          : html`<p class="muted">Nenhum intervalo definido. Use o intervalo do formulário de auditoria ou adicione a auditoria atual.</p>`}
        <div class="ranking-actions">
          <button class="btn btn-sm" data-action="use-form-range" ${job ? 'disabled' : ''} title="Usa início/fim/timezone do formulário da aba Auditoria">
            ${icon('clock', 14)} ${r.range ? (formDiffers ? 'Trocar pelo intervalo do formulário' : 'Intervalo igual ao do formulário') : 'Usar intervalo do formulário'}
          </button>
          ${canAddCurrent ? html`<button class="btn btn-sm" data-action="add-current" ${job ? 'disabled' : ''}>${icon('plus', 14)} Adicionar ${s.audit.username} (auditoria atual)</button>` : ''}
          ${r.entries.length ? html`<button class="btn btn-sm" data-action="refresh-all" ${job ? 'disabled' : ''}>${icon('refresh', 14)} Reauditar todos</button>` : ''}
          ${current.length
            ? html`<details class="dropdown">
                <summary class="btn btn-sm">${icon('download', 14)} Exportar</summary>
                <div class="dropdown-menu"><button data-action="export" data-format="csv">CSV</button><button data-action="export" data-format="json">JSON</button></div>
              </details>`
            : ''}
          <button class="btn btn-sm" data-action="import" ${job ? 'disabled' : ''} title="Abrir um ranking exportado (JSON ou CSV)">${icon('upload', 14)} Importar</button>
          ${r.range || r.entries.length ? html`<button class="btn btn-sm btn-ghost" data-action="clear" ${job ? 'disabled' : ''}>${icon('trash', 14)} Limpar</button>` : ''}
        </div>
        ${r.range
          ? html`<form id="ranking-add" class="ranking-add">
              <span class="input-icon">${icon('user', 16)}<input name="username" placeholder="Adicionar usuário ao ranking" autocomplete="off" autocapitalize="off" spellcheck="false" list="user-history" ${job ? 'disabled' : ''} /></span>
              <button class="btn btn-primary" type="submit" ${job ? 'disabled' : ''}>${icon('plus', 16)} Auditar e adicionar</button>
            </form>`
          : ''}
        ${job
          ? html`<div class="ranking-job">
              <span class="spinner spinner-sm"></span>
              <span>Auditando <strong>${job.username}</strong>${job.count ? ` (${job.index}/${job.count})` : ''} — ${PHASES[job.progress?.phase] || 'iniciando'}${job.progress?.expected ? ` ${fmtNum(job.progress.fetched)}/${fmtNum(job.progress.expected)}` : ''}</span>
              <button class="btn btn-sm" data-action="cancel">Cancelar</button>
            </div>`
          : ''}
      </section>

      ${current.length
        ? html`<div class="ranking-grid">
            <section class="card">
              <div class="table-wrap">
                <table class="table">
                  <thead><tr>
                    <th class="num">#</th><th>Usuário</th><th class="num">Scrobbles</th><th class="num">Músicas</th><th class="num">Artistas</th>
                    <th>Artista mais ouvido</th><th>Verificação</th><th>Auditado</th><th class="actions-col"><span class="sr-only">Ações</span></th>
                  </tr></thead>
                  <tbody>${current.map((e, i) => row(e, i + 1, current[0].total, job))}</tbody>
                </table>
              </div>
            </section>
            <section class="card chart-card">
              <h3 class="card-title">Scrobbles no intervalo</h3>
              ${barList({ rows: current.map((e) => ({ label: e.username, value: e.total, key: e.username })), ariaLabel: 'Comparação de scrobbles por usuário', action: 'details' })}
            </section>
          </div>`
        : r.range
          ? html`<div class="empty-state small-empty">${icon('trophy', 32)}<p class="muted">Adicione usuários para compará-los neste intervalo.</p></div>`
          : ''}

      ${stale.length
        ? html`<section class="card stale">
            <h3 class="card-title">${icon('alert', 16)} Auditados em outro intervalo</h3>
            <p class="muted small">Não entram na comparação até serem reauditados no intervalo atual.</p>
            <ul class="stale-list">
              ${stale.map(
                (e) => html`<li>
                  <strong>${e.username}</strong> <span class="muted small">${fmtNum(e.total)} scrobbles em outro intervalo</span>
                  <span class="spacer"></span>
                  <button class="btn btn-sm" data-action="refresh" data-user="${e.username}" ${job ? 'disabled' : ''}>${icon('refresh', 14)} Reauditar</button>
                  <button class="btn btn-sm btn-ghost btn-icon" data-action="remove" data-user="${e.username}" aria-label="Remover ${e.username}">${icon('trash', 14)}</button>
                </li>`,
              )}
            </ul>
          </section>`
        : ''}`,
  );
}

function row(e, pos, max, job) {
  const v = e.verification;
  const label = { missing: 'incompleta', extra: 'divergente', imported: 'importada' }[v?.status] || v?.status || '—';
  const vBadge = v?.status === 'verified' ? html`<span class="badge badge-ok">${icon('check', 12)} verificada</span>` : html`<span class="badge badge-warn">${icon('alert', 12)} ${label}</span>`;
  return html`<tr>
    <td class="num"><span class="rank rank-${pos <= 3 ? pos : 'n'}">${pos}</span></td>
    <td class="strong"><button class="link" data-action="details" data-user="${e.username}">${e.username}</button></td>
    <td class="num strong">${fmtNum(e.total)}${pos > 1 && max ? html`<span class="muted small"> (${Math.round((e.total / max) * 100)}%)</span>` : ''}</td>
    <td class="num">${fmtNum(e.uniqueTracks)}</td>
    <td class="num">${fmtNum(e.uniqueArtists)}</td>
    <td class="ellipsis" title="${e.topArtist?.artist || ''}">${e.topArtist ? html`${e.topArtist.artist} <span class="muted small">${fmtNum(e.topArtist.count)}</span>` : '—'}</td>
    <td>${vBadge}</td>
    <td class="nowrap muted small">${new Date(e.auditedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
    <td class="actions-col nowrap">
      <button class="btn btn-sm btn-ghost btn-icon" data-action="open" data-user="${e.username}" aria-label="Abrir auditoria de ${e.username}" title="Abrir auditoria completa">${icon('search', 14)}</button>
      <button class="btn btn-sm btn-ghost btn-icon" data-action="refresh" data-user="${e.username}" ${job ? 'disabled' : ''} aria-label="Reauditar ${e.username}" title="Reauditar">${icon('refresh', 14)}</button>
      <button class="btn btn-sm btn-ghost btn-icon" data-action="remove" data-user="${e.username}" aria-label="Remover ${e.username}" title="Remover">${icon('trash', 14)}</button>
    </td>
  </tr>`;
}

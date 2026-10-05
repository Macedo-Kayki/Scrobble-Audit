import { registerSource } from './sources/registry.js';
import { createLastfmSource } from './sources/lastfm/source.js';
import { createApp, applyTheme } from './ui/app.js';
import { mountAuditView } from './ui/views/auditView.js';
import { mountRankingView } from './ui/views/rankingView.js';
import { openSettings } from './ui/views/modals.js';
import { installTooltips } from './ui/components/overlay.js';
import { $, $$, html, setHtml, icon } from './ui/dom.js';
import { browserTimeZone, describeTimeZone } from './core/time.js';

// 1) Fontes de scrobbles. Para adicionar outra, registre-a aqui.
let app;
registerSource(createLastfmSource({ getApiKey: () => app?.store.get().settings.apiKey }));

// 2) Aplicação
app = createApp();
const { store, actions } = app;
applyTheme(store.get().settings.theme);

mountAuditView($('#view-audit'), app);
mountRankingView($('#view-ranking'), app);
installTooltips();

// 3) Cabeçalho: abas, timezone, tema, configurações
const header = $('#topbar-actions');
function renderHeader(s) {
  const tz = s.settings.timeZone || browserTimeZone();
  const dark = s.settings.theme === 'dark' || (s.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  setHtml(
    header,
    html`<button class="tz-badge" data-act="settings" title="Timezone usado em toda a aplicação — clique para alterar">${icon('clock', 14)} <span>${describeTimeZone(tz)}</span></button>
      <button class="btn btn-icon btn-ghost" data-act="theme" aria-label="Alternar tema" title="Alternar tema">${icon(dark ? 'sun' : 'moon', 18)}</button>
      <button class="btn btn-icon btn-ghost" data-act="settings" aria-label="Configurações" title="Configurações">${icon('settings', 18)}</button>`,
  );
}
header.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'settings') openSettings(app);
  else {
    const s = store.get().settings;
    const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    actions.setSettings({ theme: dark ? 'light' : 'dark' });
  }
});

function renderTabs(s) {
  for (const t of $$('[data-tab]')) {
    const active = t.dataset.tab === s.view.tab;
    t.setAttribute('aria-selected', String(active));
    t.tabIndex = active ? 0 : -1;
  }
  $('#view-audit').hidden = s.view.tab !== 'audit';
  $('#view-ranking').hidden = s.view.tab !== 'ranking';
  const count = s.ranking.entries.length;
  const badge = $('#ranking-count');
  badge.hidden = !count;
  badge.textContent = count;
}
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) actions.setView({ tab: t.dataset.tab, page: store.get().view.page });
});
$('#tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tabs = $$('[data-tab]');
  const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  actions.setView({ tab: next.dataset.tab, page: store.get().view.page });
  next.focus();
});

store.subscribe((s, p) => {
  if (s.settings !== p.settings) renderHeader(s);
  if (s.view !== p.view || s.ranking !== p.ranking) renderTabs(s);
});
renderHeader(store.get());
renderTabs(store.get());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderHeader(store.get()));

// Fecha dropdowns <details> ao clicar fora.
document.addEventListener('click', (e) => {
  for (const d of $$('details.dropdown[open]')) if (!d.contains(e.target)) d.removeAttribute('open');
});

// Para depuração no console.
window.scrobbleAudit = app;

import { html, $, on, icon, fmtNum } from '../dom.js';
import { openModal, confirmDialog, toast } from '../components/overlay.js';
import { columnChart } from '../components/charts.js';
import { trackKey } from '../../core/model.js';
import { AUDIT, APP, LASTFM, TIME_ZONE_LABEL } from '../../config.js';
import { friendlyMessage } from '../../core/errors.js';
import * as storage from '../../core/storage.js';
import { listSources } from '../../sources/registry.js';
import { formatDateTime, formatDate, formatTime, formatDuration, formatSpan, formatTrackLength, toIsoUtc, toIsoZoned, localParts } from '../../core/time.js';

const WEEKDAYS_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const na = html`<span class="muted">não informado</span>`;
const STATUS_LABEL = { verified: 'conferido', missing: 'faltaram scrobbles', extra: 'o total mudou', imported: 'aberto de arquivo' };

function dl(rows) {
  return html`<dl class="dl">${rows.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

/** Bloco recolhido com informações para quem precisa de detalhes técnicos. */
function techDetails(rows) {
  return html`<details class="tech-details">
    <summary>Detalhes técnicos</summary>
    ${dl(rows)}
  </details>`;
}

/* ---------- Detalhe de um scrobble ---------- */

export function openScrobble(app, id) {
  const s = app.store.get();
  const sc = s.audit?.scrobbles.find((x) => x.id === id);
  if (!sc) return;
  const tz = app.derived.timeZone();
  const ms = s.durations.get(trackKey(sc));
  const plays = app.derived.playCounts().get(trackKey(sc)) || 0;
  const p = localParts(sc.ts, tz);
  const short = (g) => (g != null && g < AUDIT.shortGapSeconds ? html` <span class="badge badge-warn">muito perto</span>` : '');
  const m = openModal({
    title: sc.track,
    subtitle: `${sc.artist}${sc.album ? ` — ${sc.album}` : ''}`,
    size: 'md',
    body: html`<div class="detail-head">
        ${sc.image ? html`<img class="cover" src="${sc.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
        <div>
          <div class="detail-time mono">${formatTime(sc.ts, tz)}</div>
          <div class="muted">${WEEKDAYS_FULL[p.weekday]}, ${formatDate(sc.ts, tz)} · ${TIME_ZONE_LABEL}</div>
        </div>
      </div>
      ${dl([
        ['Artista', sc.artist],
        ['Música', sc.track],
        ['Álbum', sc.album || na],
        ['Tempo desde o scrobble anterior', html`${sc.gapPrev == null ? '— (é o primeiro do período)' : formatDuration(sc.gapPrev)}${short(sc.gapPrev)}`],
        ['Tempo até o próximo scrobble', html`${sc.gapNext == null ? '— (é o último do período)' : formatDuration(sc.gapNext)}${short(sc.gapNext)}`],
        ['Duração da música', ms != null ? formatTrackLength(ms) : s.durations.has(trackKey(sc)) ? na : html`<span class="muted">ainda não buscada</span>`],
        ['Vezes que esta música tocou no período', fmtNum(plays)],
      ])}
      ${techDetails([
        ['Código de data (Unix)', html`<code>${sc.ts}</code>`],
        ['Horário universal (UTC)', html`<code>${toIsoUtc(sc.ts)}</code>`],
        ['Horário local', html`<code>${toIsoZoned(sc.ts, tz)}</code>`],
        ['ID MusicBrainz do artista', sc.artistMbid ? html`<code>${sc.artistMbid}</code>` : na],
        ['ID MusicBrainz da música', sc.trackMbid ? html`<code>${sc.trackMbid}</code>` : na],
        ['ID MusicBrainz do álbum', sc.albumMbid ? html`<code>${sc.albumMbid}</code>` : na],
        ['Identificador na auditoria', html`<code>${sc.id}</code>`],
      ])}`,
    footer: html`${sc.url ? html`<a class="btn btn-ghost" href="${sc.url}" target="_blank" rel="noopener">${icon('external', 14)} Ver na ${s.audit.sourceName}</a>` : ''}
      <span class="spacer"></span>
      <button class="btn" data-act="artist">Mostrar só este artista</button>
      <button class="btn btn-primary" data-act="times">${icon('clock', 14)} Todas as vezes que tocou</button>`,
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

/* ---------- Todas as vezes que uma música tocou ---------- */

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
    subtitle: `${first.artist} · tocou ${fmtNum(items.length)} vez(es) no período`,
    size: 'lg',
    body: html`<div class="tiles tiles-compact">
        <div class="tile"><span class="tile-label">Vezes</span><span class="tile-value">${fmtNum(items.length)}</span></div>
        <div class="tile"><span class="tile-label">Primeira vez</span><span class="tile-value tile-value-sm">${formatDateTime(items[0].ts, tz)}</span></div>
        <div class="tile"><span class="tile-label">Última vez</span><span class="tile-value tile-value-sm">${formatDateTime(items[items.length - 1].ts, tz)}</span></div>
        <div class="tile"><span class="tile-label">Menor tempo entre duas vezes</span><span class="tile-value tile-value-sm">${minGap == null ? '—' : formatDuration(minGap)}</span></div>
      </div>
      <h3 class="section-title">Em que horário do dia</h3>
      ${columnChart({ data: byHour.map((v, h) => ({ label: `${String(h).padStart(2, '0')}h`, value: v })), ariaLabel: 'Vezes que esta música tocou em cada horário do dia', unit: 'vez(es)' })}
      <h3 class="section-title">Todos os horários</h3>
      <div class="times-list">
        ${[...byDay].map(
          ([day, list]) => html`<div class="times-day">
            <div class="times-day-head"><strong>${day}</strong> <span class="muted small">${fmtNum(list.length)} vez(es)</span></div>
            <div class="times-chips">${list.map((it) => html`<button type="button" class="time-chip mono" data-id="${it.id}" title="Ver detalhes">${formatTime(it.ts, tz)}</button>`)}</div>
          </div>`,
        )}
      </div>`,
    footer: html`<button class="btn" data-act="filter">${icon('filter', 14)} Mostrar só esta música na lista</button>
      <span class="spacer"></span>
      <button class="btn" data-act="json" title="Arquivo para abrir no Scrobble Audit depois">${icon('download', 14)} Arquivo</button>
      <button class="btn btn-primary" data-act="csv" title="Planilha que abre no Excel">${icon('download', 14)} Planilha</button>`,
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
  const tz = app.derived.timeZone();
  const v = a.verification;
  const r = a.range;
  const end = r.requestedTo ?? r.to;
  const imp = a.imported;
  const yesNo = (b) => (b ? 'sim' : 'não');
  openModal({
    title: 'Detalhes da auditoria',
    subtitle: `${a.username} · ${a.sourceName}`,
    size: 'lg',
    body: html`<h3 class="section-title">Período</h3>
      ${dl([
        ['De', formatDateTime(r.from, tz)],
        ['Até', formatDateTime(end, tz)],
        ['Duração', formatSpan(end - r.from)],
        ['Horários', TIME_ZONE_LABEL],
      ])}
      ${imp
        ? html`<h3 class="section-title">Arquivo</h3>
            ${dl([
              ['Nome do arquivo', imp.fileName || '—'],
              ['O que ele contém', imp.scope === 'filtered' ? 'só uma parte da auditoria (o que estava filtrado)' : 'a auditoria inteira'],
              imp.rangeDerived && ['Período', 'o arquivo não informa; usamos do primeiro ao último scrobble'],
              imp.exportedAt && ['Salvo em', new Date(imp.exportedAt).toLocaleString('pt-BR')],
              ['Aberto em', new Date(imp.importedAt).toLocaleString('pt-BR')],
              v.original && ['Total conferido quando foi salvo?', yesNo(v.original.status === 'verified')],
            ])}
            <p class="hint">Estes dados vêm do arquivo e não foram buscados de novo na ${a.sourceName}. Use “Auditar de novo” para conferir agora.</p>`
        : html`<h3 class="section-title">Conferência</h3>
            ${dl([
              ['Resultado', html`<span class="badge ${v.status === 'verified' ? 'badge-ok' : 'badge-warn'}">${STATUS_LABEL[v.status] || v.status}</span>`],
              ['Total informado pela ' + a.sourceName, fmtNum(v.expected)],
              ['Scrobbles encontrados', fmtNum(a.scrobbles.length)],
              ['Chegaram ou sumiram scrobbles durante a busca?', yesNo(v.changedDuringAudit)],
              v.nowPlayingSeen && ['Música tocando agora', 'não entra, porque ainda não virou scrobble'],
            ])}`}
      <h3 class="section-title">Busca</h3>
      ${dl(
        imp
          ? [
              ['Auditoria original feita em', new Date(a.finishedAt).toLocaleString('pt-BR')],
              ['Salva neste navegador', s.auditPersisted === false ? 'não (é grande demais)' : 'sim'],
            ]
          : [
              ['Feita em', new Date(a.finishedAt).toLocaleString('pt-BR')],
              ['Levou', formatDuration(a.durationMs / 1000)],
              ['Salva neste navegador', s.auditPersisted === false ? 'não (é grande demais)' : 'sim'],
            ],
      )}
      <h3 class="section-title">Como a busca funciona</h3>
      <ul class="method">
        <li>Cada scrobble é encontrado pelo horário exato em que foi registrado, ao segundo.</li>
        <li>Mesmo que a pessoa ouça músicas novas enquanto a busca acontece, nada fica de fora.</li>
        <li>No fim, comparamos quantos encontramos com o total que a ${a.sourceName} informa. Se faltar algo, buscamos de novo.</li>
        <li>A música que está tocando agora não entra, porque ainda não virou scrobble.</li>
        <li>Quando a ${a.sourceName} não informa algo (como o álbum), mostramos “não informado”. Nada é inventado.</li>
      </ul>
      ${techDetails(
        imp
          ? [
              ['Intervalo (Unix)', html`<code>${r.from}</code> até <code>${r.to}</code>`],
              ['Início (UTC)', html`<code>${toIsoUtc(r.from)}</code>`],
              ['Fim (UTC)', html`<code>${toIsoUtc(r.to)}</code>`],
              ['Formato do arquivo', imp.format.toUpperCase()],
              imp.filters && ['Filtros usados na exportação', html`<code>${JSON.stringify(imp.filters)}</code>`],
              v.original && ['Conferência original', `${v.original.status} (${fmtNum(v.original.fetchedInWindow)} de ${fmtNum(v.original.expected)})`],
              a.requests > 0 && ['Requisições da auditoria original', fmtNum(a.requests)],
            ]
          : [
              ['Intervalo (Unix)', html`<code>${r.from}</code> até <code>${r.to}</code>`],
              ['Início (UTC)', html`<code>${toIsoUtc(r.from)}</code>`],
              ['Fim (UTC)', html`<code>${toIsoUtc(r.to)}</code>`],
              ['Fim inclusivo', yesNo(r.inclusiveEnd)],
              ['Janela consultada na API', v.queryWindow ? html`<code>from=${v.queryWindow.from}</code> <code>to=${v.queryWindow.to}</code>` : '—'],
              ['Total da API no início / no fim', `${fmtNum(v.initialExpected)} / ${fmtNum(v.expected)}`],
              ['Coletados na janela', fmtNum(v.fetchedInWindow)],
              ['Passadas extras de busca', fmtNum(v.reconciliationPasses ?? 0)],
              ['Requisições', fmtNum(a.requests)],
              ['Novas tentativas', fmtNum(a.retries)],
            ],
      )}`,
  });
}

/* ---------- Configurações ---------- */

export function openSettings(app) {
  const s = app.store.get();
  const st = s.settings;
  const usage = storage.usageBytes();
  const sources = listSources();
  const m = openModal({
    title: 'Configurações',
    size: 'md',
    body: html`<form class="settings" id="settings-form">
      ${sources.length > 1
        ? html`<label class="field">
            <span class="field-label">De onde vêm os scrobbles</span>
            <select name="source">${sources.map((src) => html`<option value="${src.id}" ${src.id === st.source ? 'selected' : ''}>${src.name}</option>`)}</select>
          </label>`
        : html`<input type="hidden" name="source" value="${st.source}" />`}
      ${LASTFM.proxyUrl
        ? html`<p class="proxy-note">${icon('check', 14)} Este site já está pronto para usar. Você não precisa configurar nenhuma chave.</p>`
        : ''}
      <details class="settings-key" ${LASTFM.proxyUrl && !st.apiKey ? '' : 'open'}>
        <summary>${LASTFM.proxyUrl ? 'Usar minha própria chave de acesso (opcional)' : 'Chave de acesso da Last.fm'}</summary>
        <label class="field">
          <span class="input-group">
            <input name="apiKey" type="password" autocomplete="off" spellcheck="false" value="${st.apiKey}" placeholder="cole sua chave aqui" aria-label="Chave de acesso da Last.fm" />
            <button type="button" class="btn btn-icon" data-act="toggle-key" aria-label="Mostrar ou esconder a chave">${icon('eye', 16)}</button>
            <button type="button" class="btn" data-act="test-key">Testar</button>
          </span>
          <span class="hint">Peça uma chave grátis em <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener">last.fm/api/account/create</a> e copie o código chamado “API key”. Ela fica salva só neste navegador.</span>
          <span class="hint" id="key-test" aria-live="polite"></span>
        </label>
      </details>
      <label class="check"><input type="checkbox" name="inclusiveEnd" ${st.inclusiveEnd ? 'checked' : ''} /> Contar scrobbles feitos exatamente no horário final <span class="muted small">(de 08:00 até 13:00 inclui um scrobble às 13:00:00)</span></label>
      <div class="row-2">
        <label class="field">
          <span class="field-label">Formato da planilha</span>
          <select name="csvDelimiter">
            <option value=";" ${st.csvDelimiter === ';' ? 'selected' : ''}>Excel em português</option>
            <option value="," ${st.csvDelimiter === ',' ? 'selected' : ''}>Padrão internacional</option>
            <option value="&#9;" ${st.csvDelimiter === '\t' ? 'selected' : ''}>Separada por tabulação</option>
          </select>
          <span class="hint">Se a planilha abrir toda em uma coluna só, troque esta opção.</span>
        </label>
        <label class="field">
          <span class="field-label">Aparência</span>
          <select name="theme">
            ${[['auto', 'Igual ao do aparelho'], ['light', 'Clara'], ['dark', 'Escura']].map(([v, l]) => html`<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`)}
          </select>
        </label>
      </div>
      <div class="storage-box">
        <div><strong>Dados salvos neste navegador</strong><p class="muted small">${fmtNum(Math.max(1, Math.round(usage / 1024)))} KB — histórico, ranking, última auditoria e durações de músicas.</p></div>
        <button type="button" class="btn btn-danger btn-sm" data-act="clear">${icon('trash', 14)} Apagar tudo</button>
      </div>
      <p class="muted small">${APP.name} versão ${APP.version} · suas auditorias ficam salvas só neste navegador.</p>
    </form>`,
    footer: html`<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-act="save">Salvar</button>`,
  });
  const form = $('#settings-form', m.el);
  const save = () => {
    const f = form.elements;
    app.actions.setSettings({
      source: f.source.value,
      apiKey: f.apiKey.value.trim(),
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
      if (!key) return (out.textContent = 'Cole a chave antes de testar.');
      out.textContent = 'Testando…';
      try {
        const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=rj&api_key=${encodeURIComponent(key)}&format=json`);
        const body = await res.json();
        out.textContent = body.error ? 'Essa chave não funcionou. Confira se copiou o código certo.' : '✓ A chave funciona.';
      } catch (e) {
        out.textContent = `Não deu para testar agora: ${friendlyMessage(e)}`;
      }
    } else if (act === 'clear') {
      const ok = await confirmDialog({
        title: 'Apagar tudo',
        message: 'Isso apaga deste navegador o histórico, o ranking, os filtros, a última auditoria, as durações salvas e a sua chave de acesso (se você colocou uma). Não dá para desfazer.',
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
    subtitle: 'Resumo no período do ranking',
    size: 'md',
    body: html`${dl([
        ['Scrobbles', fmtNum(e.total)],
        ['Músicas diferentes', fmtNum(e.uniqueTracks)],
        ['Artistas diferentes', fmtNum(e.uniqueArtists)],
        ['Primeiro scrobble', e.first ? formatDateTime(e.first, tz) : '—'],
        ['Último scrobble', e.last ? formatDateTime(e.last, tz) : '—'],
        e.shortGaps != null && ['Scrobbles muito próximos', fmtNum(e.shortGaps)],
        ['Conferência', e.verification ? STATUS_LABEL[e.verification.status] || e.verification.status : '—'],
        ['Auditado em', e.auditedAt ? new Date(e.auditedAt).toLocaleString('pt-BR') : '—'],
      ])}
      <div class="row-2">
        <div><h3 class="section-title">Artistas mais ouvidos</h3>${list(e.topArtists, (r) => r.artist)}</div>
        <div><h3 class="section-title">Músicas mais ouvidas</h3>${list(e.topTracks, (r) => `${r.track} — ${r.artist}`)}</div>
      </div>`,
    footer: html`<span class="spacer"></span><button class="btn btn-primary" data-act="open">${icon('search', 14)} Ver auditoria completa</button>`,
  });
  on(m.el, 'click', '[data-act="open"]', () => {
    m.close();
    app.actions.openInAudit(e.username);
  });
}

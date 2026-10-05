import { html, fmtNum } from '../dom.js';

/**
 * Gráficos em HTML/CSS puro (sem bibliotecas). Série única => sem legenda;
 * o título do card identifica o que está plotado. Tooltip via [data-tip].
 */

/** Teto "redondo" para o eixo Y. */
export function niceMax(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/**
 * Colunas verticais.
 * @param {{ data: { label: string, value: number, tip?: string }[], ariaLabel: string, unit?: string, maxLabels?: number }} o
 */
export function columnChart({ data, ariaLabel, unit = 'scrobbles', maxLabels = 8 }) {
  if (!data.length) return html`<p class="muted">Sem dados.</p>`;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const ticks = Number.isInteger(max / 2) ? [max, max / 2, 0] : [max, 0]; // contagens são inteiras
  const step = Math.max(1, Math.ceil(data.length / maxLabels));
  const peak = data.reduce((a, d) => (d.value > a.value ? d : a), data[0]);
  return html`<figure class="colchart" role="img" aria-label="${ariaLabel}. Máximo: ${fmtNum(peak.value)} ${unit} em ${peak.label}.">
    <div class="colchart-plot">
      <div class="colchart-grid" aria-hidden="true">
        ${ticks.map((t) => html`<div class="gridline" style="bottom:${(t / max) * 100}%"><span>${fmtNum(t)}</span></div>`)}
      </div>
      <div class="colchart-bars ${data.length > 60 ? 'dense' : ''}">
        ${data.map(
          (d) =>
            html`<div class="col" tabindex="0" data-tip="${d.tip || `${d.label}: ${fmtNum(d.value)} ${unit}`}"><span style="height:${(d.value / max) * 100}%"></span></div>`,
        )}
      </div>
    </div>
    <div class="colchart-x" aria-hidden="true">
      ${data.map((d, i) => html`<span>${i % step === 0 ? d.label : ''}</span>`)}
    </div>
  </figure>`;
}

/**
 * Barras horizontais ranqueadas (top artistas/músicas/usuários).
 * @param {{ rows: { label: string, sub?: string, value: number, action?: string, key?: string }[], unit?: string, ariaLabel: string }} o
 */
export function barList({ rows, unit = 'scrobbles', ariaLabel, action }) {
  if (!rows.length) return html`<p class="muted">Sem dados.</p>`;
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  return html`<ol class="barlist" aria-label="${ariaLabel}">
    ${rows.map(
      (r, i) => html`<li>
        <button class="barlist-row" type="button" ${action ? html`data-action="${action}" data-key="${r.key ?? ''}"` : 'disabled'} data-tip="${r.label}${r.sub ? ` — ${r.sub}` : ''}: ${fmtNum(r.value)} ${unit}">
          <span class="barlist-rank">${i + 1}</span>
          <span class="barlist-text">
            <span class="barlist-label">${r.label}</span>
            ${r.sub ? html`<span class="barlist-sub">${r.sub}</span>` : ''}
            <span class="barlist-track"><span class="barlist-bar" style="width:${(r.value / max) * 100}%"></span></span>
          </span>
          <span class="barlist-value">${fmtNum(r.value)}</span>
        </button>
      </li>`,
    )}
  </ol>`;
}

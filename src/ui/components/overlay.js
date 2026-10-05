import { html, setHtml, icon, $, on } from '../dom.js';

/* ---------------- Modal ---------------- */

let modalRoot;
let lastFocus;
const stack = [];

function ensureRoot() {
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
    });
  }
  return modalRoot;
}

/**
 * Abre um modal. `body` e `footer` são resultados de `html`.
 * @returns {{ el: HTMLElement, close: Function, setBody: Function }}
 */
export function openModal({ title, subtitle, body, footer, size = 'md', onClose }) {
  ensureRoot();
  if (!stack.length) lastFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  setHtml(
    wrap,
    html`<div class="modal modal-${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title-${stack.length}">
      <header class="modal-header">
        <div>
          <h2 id="modal-title-${stack.length}" class="modal-title">${title}</h2>
          ${subtitle ? html`<p class="modal-subtitle">${subtitle}</p>` : ''}
        </div>
        <button class="btn btn-icon btn-ghost" data-close aria-label="Fechar">${icon('x', 18)}</button>
      </header>
      <div class="modal-body"></div>
      ${footer ? html`<footer class="modal-footer"></footer>` : ''}
    </div>`,
  );
  const el = $('.modal', wrap);
  setHtml($('.modal-body', el), body);
  if (footer) setHtml($('.modal-footer', el), footer);
  modalRoot.appendChild(wrap);
  document.body.classList.add('no-scroll');

  const api = {
    el,
    close() {
      const i = stack.indexOf(api);
      if (i === -1) return;
      stack.splice(i, 1);
      wrap.remove();
      if (!stack.length) {
        document.body.classList.remove('no-scroll');
        lastFocus?.focus?.();
      }
      onClose?.();
    },
    setBody(content) {
      setHtml($('.modal-body', el), content);
    },
  };
  stack.push(api);
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) api.close();
  });
  on(el, 'click', '[data-close]', () => api.close());
  requestAnimationFrame(() => (el.querySelector('[autofocus]') || el.querySelector('input, select, button:not([data-close])') || el).focus());
  return api;
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title,
      size: 'sm',
      body: html`<p class="confirm-message">${message}</p>`,
      footer: html`<button class="btn btn-ghost" data-answer="no">${cancelLabel}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes" autofocus>${confirmLabel}</button>`,
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    on(m.el, 'click', '[data-answer]', (_e, b) => {
      answered = true;
      resolve(b.dataset.answer === 'yes');
      m.close();
    });
  });
}

/* ---------------- Toasts ---------------- */

let toastRoot;
export function toast(message, type = 'info', ms = 4500) {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toast-root';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRoot);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const ic = { success: 'check', error: 'alert', warning: 'alert', info: 'info' }[type] || 'info';
  setHtml(el, html`${icon(ic, 16)}<span>${message}</span><button class="btn btn-icon btn-ghost" aria-label="Fechar">${icon('x', 14)}</button>`);
  el.querySelector('button').onclick = () => el.remove();
  toastRoot.appendChild(el);
  setTimeout(() => el.classList.add('toast-out'), ms);
  setTimeout(() => el.remove(), ms + 300);
}

/* ---------------- Tooltip (gráficos) ---------------- */

let tip;
export function installTooltips(root = document.body) {
  if (tip) return;
  tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  const show = (e, el) => {
    tip.textContent = el.dataset.tip;
    tip.classList.add('visible');
    move(e);
  };
  const move = (e) => {
    const pad = 12;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY - r.height - pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y < 8) y = e.clientY + pad;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };
  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) show(e, el);
  });
  root.addEventListener('pointermove', (e) => {
    if (tip.classList.contains('visible')) move(e);
  });
  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) tip.classList.remove('visible');
  });
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    show({ clientX: r.left + r.width / 2, clientY: r.top }, el);
  });
  root.addEventListener('focusout', () => tip.classList.remove('visible'));
}

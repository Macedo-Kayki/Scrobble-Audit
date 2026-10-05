import { html, setHtml, icon } from '../dom.js';

export const IMPORT_ACCEPT = '.json,.csv,application/json,text/csv';

/** Abre o seletor de arquivos e resolve com o arquivo escolhido (ou null). */
export function pickFile(accept = IMPORT_ACCEPT) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.addEventListener('change', () => {
      resolve(input.files?.[0] || null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Permite soltar um arquivo em qualquer lugar da página para importá-lo. */
export function installDropZone(onFile) {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.hidden = true;
  setHtml(overlay, html`<div class="drop-box">${icon('upload', 28)}<strong>Solte para importar</strong><span>Arquivo ou planilha exportada pelo Scrobble Audit</span></div>`);
  document.body.appendChild(overlay);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  });
}

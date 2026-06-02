// Application entry point and simple router between the library and viewer.

import { renderLibrary } from './library.js';
import { renderViewer } from './viewer.js';

const root = document.getElementById('root');
let activeToast = null;

function getLibraryScrollTop() {
  return root.querySelector('.library')?.scrollTop ?? 0;
}

function restoreLibraryScrollTop(scrollTop) {
  requestAnimationFrame(() => {
    root.querySelector('.library')?.scrollTo({ top: scrollTop });
  });
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function closeToast() {
  if (!activeToast) return;
  clearTimeout(activeToast.timer);
  activeToast.node.remove();
  activeToast = null;
}

function showToast(message, actionLabel = '', onAction = null, timeout = 5000) {
  closeToast();

  const toast = document.createElement('div');
  toast.className = 'toast';

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  if (actionLabel && onAction) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', async () => {
      closeToast();
      await onAction();
    });
    toast.appendChild(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.textContent = '×';
  close.addEventListener('click', closeToast);
  toast.appendChild(close);

  document.body.appendChild(toast);
  const timer = setTimeout(closeToast, timeout);
  activeToast = { node: toast, timer };
}

async function captureViewSnapshot(id) {
  const [meta, pdf] = await Promise.all([window.api.getView(id), window.api.getViewPdf(id)]);
  return { id, meta, pdfBase64: bytesToBase64(pdf) };
}

async function captureViewSnapshots(ids) {
  return Promise.all(ids.map((id) => captureViewSnapshot(id)));
}

async function restoreSnapshots(snapshots) {
  for (const snapshot of snapshots) {
    await window.api.restoreView(snapshot);
  }
}

async function showLibrary() {
  const scrollTop = getLibraryScrollTop();
  const views = await window.api.listViews();

  renderLibrary(root, views, {
    onCreate: async () => {
      const view = await window.api.createView();
      if (view) showViewer(view.id);
    },
    onOpen: (id) => showViewer(id),
    onDelete: async (id) => {
      const snapshot = await captureViewSnapshot(id);
      await window.api.deleteView(id);
      await showLibrary();
      showToast('View deleted.', 'Undo', async () => {
        await restoreSnapshots([snapshot]);
        await showLibrary();
      });
    },
    onRename: async (id, name) => {
      const previous = await window.api.getView(id);
      await window.api.updateView(id, { name });
      await showLibrary();
      showToast('View renamed.', 'Undo', async () => {
        await window.api.updateView(id, { name: previous.name });
        await showLibrary();
      });
    },
    onSetCategory: async (id, category) => {
      const previous = await window.api.getView(id);
      await window.api.updateView(id, { category });
      await showLibrary();
      showToast('Category updated.', 'Undo', async () => {
        await window.api.updateView(id, { category: (previous.category || '').trim() });
        await showLibrary();
      });
    },
    onRemoveCategory: async (id) => {
      const previous = await window.api.getView(id);
      await window.api.updateView(id, { category: '' });
      await showLibrary();
      showToast('Category removed.', 'Undo', async () => {
        await window.api.updateView(id, { category: (previous.category || '').trim() });
        await showLibrary();
      });
    },
    onRenameCategory: async (oldName, newName) => {
      const all = await window.api.listViews();
      const targets = all.filter((v) => (v.category || '').trim() === oldName).map((v) => v.id);
      await Promise.all(targets.map((id) => window.api.updateView(id, { category: newName })));
      await showLibrary();
      showToast('Category renamed.', 'Undo', async () => {
        await Promise.all(targets.map((id) => window.api.updateView(id, { category: oldName })));
        await showLibrary();
      });
    },
    onDeleteCategory: async (name) => {
      const all = await window.api.listViews();
      const targets = all.filter((v) => (v.category || '').trim() === name).map((v) => v.id);
      await Promise.all(targets.map((id) => window.api.updateView(id, { category: '' })));
      await showLibrary();
      showToast('Category deleted.', 'Undo', async () => {
        await Promise.all(targets.map((id) => window.api.updateView(id, { category: name })));
        await showLibrary();
      });
    },
    onBulkSetCategory: async (ids, category) => {
      const previous = await Promise.all(ids.map((id) => window.api.getView(id)));
      await Promise.all(ids.map((id) => window.api.updateView(id, { category })));
      await showLibrary();
      showToast('Moved selected views.', 'Undo', async () => {
        await Promise.all(
          previous.map((view) => window.api.updateView(view.id, { category: (view.category || '').trim() }))
        );
        await showLibrary();
      });
    },
    onBulkRemoveCategory: async (ids) => {
      const previous = await Promise.all(ids.map((id) => window.api.getView(id)));
      await Promise.all(ids.map((id) => window.api.updateView(id, { category: '' })));
      await showLibrary();
      showToast('Removed categories from selected views.', 'Undo', async () => {
        await Promise.all(
          previous.map((view) => window.api.updateView(view.id, { category: (view.category || '').trim() }))
        );
        await showLibrary();
      });
    },
    onBulkDelete: async (ids) => {
      const snapshots = await captureViewSnapshots(ids);
      await Promise.all(ids.map((id) => window.api.deleteView(id)));
      await showLibrary();
      showToast(`Deleted ${ids.length} view${ids.length === 1 ? '' : 's'}.`, 'Undo', async () => {
        await restoreSnapshots(snapshots);
        await showLibrary();
      });
    },
    onRevealPdf: (id) => window.api.revealViewPdf(id),
    onExportMetadata: async () => {
      const result = await window.api.exportMetadata();
      if (!result?.saved) return;
      showToast(`Exported metadata for ${result.count} view${result.count === 1 ? '' : 's'}.`);
    },
    onImportMetadata: async () => {
      const result = await window.api.importMetadata();
      if (!result || (!result.imported && !result.skipped)) return;
      await showLibrary();
      showToast(`Imported ${result.imported} metadata update${result.imported === 1 ? '' : 's'}.`);
    },
    onRefresh: showLibrary,
  });

  restoreLibraryScrollTop(scrollTop);
  root.focus();
}

async function showViewer(id) {
  const [view, bytes] = await Promise.all([window.api.getView(id), window.api.getViewPdf(id)]);
  await renderViewer(root, view, bytes, {
    onBack: showLibrary,
    onChange: (patch) => window.api.updateView(id, patch),
  });
}

// --- Window chrome: custom title bar + fullscreen toggle -------------------
const ICONS = {
  minimize: '<svg viewBox="0 0 12 12" width="11" height="11"><rect x="1.5" y="5.5" width="9" height="1" fill="currentColor"/></svg>',
  maximize: '<svg viewBox="0 0 12 12" width="11" height="11"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  restore: '<svg viewBox="0 0 12 12" width="11" height="11"><rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="1.5" y="3.5" width="7" height="7" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.1"/></svg>',
  close: '<svg viewBox="0 0 12 12" width="11" height="11"><path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
};

function winButton(label, html, className, onClick) {
  const btn = document.createElement('button');
  btn.className = 'win-btn ' + className;
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = html;
  btn.addEventListener('click', onClick);
  return btn;
}

function setupChrome() {
  const controls = document.getElementById('window-controls');
  const minBtn = winButton('Minimize', ICONS.minimize, 'win-min', () => window.api.minimizeWindow());
  const maxBtn = winButton('Maximize', ICONS.maximize, 'win-max', () => window.api.toggleMaximizeWindow());
  const closeBtn = winButton('Close', ICONS.close, 'win-close', () => window.api.closeWindow());
  controls.append(minBtn, maxBtn, closeBtn);

  const reflectMax = (isMax) => {
    maxBtn.innerHTML = isMax ? ICONS.restore : ICONS.maximize;
    maxBtn.title = isMax ? 'Restore' : 'Maximize';
    maxBtn.setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
  };
  window.api.onMaximizeChange(reflectMax);
  window.api.isMaximized().then(reflectMax);

  const btn = document.createElement('button');
  btn.className = 'fullscreen-btn';
  btn.type = 'button';
  btn.title = 'Toggle full screen (F11)';
  btn.setAttribute('aria-label', 'Enter full screen');
  btn.textContent = '⛶';
  btn.addEventListener('click', () => window.api.toggleFullscreen());
  document.body.appendChild(btn);

  const reflectFull = (isFull) => {
    btn.textContent = isFull ? '🗕' : '⛶';
    btn.setAttribute('aria-label', isFull ? 'Exit full screen' : 'Enter full screen');
    document.body.classList.toggle('is-fullscreen', isFull);
  };
  window.api.onFullscreenChange(reflectFull);
  window.api.isFullscreen().then(reflectFull);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      window.api.toggleFullscreen();
    }
  });
}

setupChrome();
showLibrary();

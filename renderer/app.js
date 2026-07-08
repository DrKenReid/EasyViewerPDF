// Application entry point and simple router between the library and viewer.

import { renderLibrary, removeLibraryShortcuts } from './library.js';
import { renderViewer } from './viewer.js';
import { isOverlayOpen } from './ui.js';

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
  // Announce toasts to assistive tech; role="status" implies aria-live="polite".
  toast.setAttribute('role', 'status');

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
  const [views, config] = await Promise.all([window.api.listViews(), window.api.getLibraryConfig()]);

  // Add/remove a tag id on a view, returning the next tags array.
  const withTag = (tags, tagId) => (tags.includes(tagId) ? tags : [...tags, tagId]);
  const withoutTag = (tags, tagId) => tags.filter((t) => t !== tagId);

  renderLibrary(root, views, config, {
    onCreate: async (tags = []) => {
      try {
        const created = await window.api.createViews({ tags });
        if (!created?.length) return;
        if (created.length === 1) {
          showViewer(created[0].id);
          return;
        }
        await showLibrary();
        showToast(`Imported ${created.length} view${created.length === 1 ? '' : 's'}.`);
      } catch (error) {
        console.error(error);
        showToast('Import failed. Please try again.', undefined, undefined, 5000);
      }
    },
    onOpen: (id) => showViewer(id, true),
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
    onAddTag: async (id, tagId) => {
      const previous = await window.api.getView(id);
      await window.api.updateView(id, { tags: withTag(previous.tags || [], tagId) });
      await showLibrary();
      showToast('Tag added.', 'Undo', async () => {
        await window.api.updateView(id, { tags: previous.tags || [] });
        await showLibrary();
      });
    },
    onRemoveTag: async (id, tagId) => {
      const previous = await window.api.getView(id);
      await window.api.updateView(id, { tags: withoutTag(previous.tags || [], tagId) });
      await showLibrary();
      showToast('Tag removed.', 'Undo', async () => {
        await window.api.updateView(id, { tags: previous.tags || [] });
        await showLibrary();
      });
    },
    onSetTags: async (id, tags) => {
      const previous = await window.api.getView(id);
      await window.api.updateView(id, { tags });
      await showLibrary();
      showToast('Tags updated.', 'Undo', async () => {
        await window.api.updateView(id, { tags: previous.tags || [] });
        await showLibrary();
      });
    },
    onCreateTag: async (def) => {
      try {
        const tag = await window.api.createTag(def);
        await showLibrary();
        return tag;
      } catch (error) {
        console.error(error);
        showToast('Could not create tag.', undefined, undefined, 4000);
        return null;
      }
    },
    onUpdateTag: async (id, def) => {
      await window.api.updateTag(id, def);
      await showLibrary();
      showToast('Tag updated.');
    },
    onDeleteTag: async (id) => {
      await window.api.deleteTag(id);
      await showLibrary();
      showToast('Tag deleted.');
    },
    onReorderTags: async (ids) => {
      await window.api.reorderTags(ids);
      await showLibrary();
    },
    onSetSectionSort: async (value) => {
      await window.api.setSectionSort(value);
      await showLibrary();
    },
    onBulkAddTag: async (ids, tagId) => {
      const previous = await Promise.all(ids.map((id) => window.api.getView(id)));
      await Promise.all(previous.map((v) => window.api.updateView(v.id, { tags: withTag(v.tags || [], tagId) })));
      await showLibrary();
      showToast('Tagged selected views.', 'Undo', async () => {
        await Promise.all(previous.map((v) => window.api.updateView(v.id, { tags: v.tags || [] })));
        await showLibrary();
      });
    },
    onBulkRemoveTag: async (ids, tagId) => {
      const previous = await Promise.all(ids.map((id) => window.api.getView(id)));
      await Promise.all(previous.map((v) => window.api.updateView(v.id, { tags: withoutTag(v.tags || [], tagId) })));
      await showLibrary();
      showToast('Removed tag from selected views.', 'Undo', async () => {
        await Promise.all(previous.map((v) => window.api.updateView(v.id, { tags: v.tags || [] })));
        await showLibrary();
      });
    },
    onBulkClearTags: async (ids) => {
      const previous = await Promise.all(ids.map((id) => window.api.getView(id)));
      await Promise.all(previous.map((v) => window.api.updateView(v.id, { tags: [] })));
      await showLibrary();
      showToast('Cleared tags from selected views.', 'Undo', async () => {
        await Promise.all(previous.map((v) => window.api.updateView(v.id, { tags: v.tags || [] })));
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
    onImportFiles: async (paths, tags = []) => {
      try {
        const created = await window.api.createViews({ filePaths: paths, tags });
        if (!created?.length) return;
        await showLibrary();
        showToast(`Imported ${created.length} PDF${created.length === 1 ? '' : 's'}.`);
      } catch (error) {
        console.error(error);
        showToast('Import failed. Please try again.', undefined, undefined, 5000);
      }
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

async function showViewer(id, stampOpened = false) {
  try {
    const [view, bytes] = await Promise.all([window.api.getView(id), window.api.getViewPdf(id)]);
    removeLibraryShortcuts();
    if (stampOpened) {
      window.api.updateView(id, { lastOpenedAt: new Date().toISOString() }).catch(console.error);
    }
    await renderViewer(root, view, bytes, {
      onBack: showLibrary,
      onChange: (patch) => window.api.updateView(id, patch).catch(console.error),
    });
  } catch (error) {
    console.error(error);
    showToast('Could not open this view.', undefined, undefined, 5000);
  }
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
    if (e.defaultPrevented || isOverlayOpen()) return;

    if (e.key === 'F11') {
      e.preventDefault();
      window.api.isFullscreen().then((isFull) => {
        if (!isFull) window.api.toggleFullscreen();
      });
      return;
    }

    if (e.key === 'Escape') {
      window.api.isFullscreen().then((isFull) => {
        if (!isFull) return;
        e.preventDefault();
        window.api.toggleFullscreen();
      });
    }
  });
}

setupChrome();
showLibrary();

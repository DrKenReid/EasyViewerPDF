// The library screen: a grid of saved views with search, sorting, categories,
// multi-select bulk actions, and drag/drop categorization.

import { el, clear, iconButton } from './dom.js';
import { loadPdf, renderPage } from './pdfutil.js';
import { confirmDialog, promptDialog, openContextMenu, isOverlayOpen } from './ui.js';

const RECENT_COUNT = 8;

const libraryState = {
  query: '',
  categoryFilter: 'all',
  sortBy: 'recent',
  selectionMode: false,
  selectedIds: new Set(),
  restoreSearchFocus: false,
  searchSelectionStart: 0,
  searchSelectionEnd: 0,
};

let removeShortcuts = null;

/**
 * @param {HTMLElement} root
 * @param {Array} views
 * @param {{
 *   onCreate: Function,
 *   onOpen: Function,
 *   onDelete: Function,
 *   onRename: Function,
 *   onSetCategory: Function,
 *   onRemoveCategory: Function,
 *   onRenameCategory: Function,
 *   onDeleteCategory: Function,
 *   onBulkSetCategory: Function,
 *   onBulkRemoveCategory: Function,
 *   onBulkDelete: Function,
 *   onRevealPdf: Function,
 *   onExportMetadata: Function,
 *   onImportMetadata: Function,
 *   onRefresh: Function,
 * }} handlers
 */
export function renderLibrary(root, views, handlers) {
  if (removeShortcuts) {
    removeShortcuts();
    removeShortcuts = null;
  }

  pruneSelection(views);
  pruneThumbCache(views);

  clear(root);

  const page = el('div', 'library');

  const header = el('header', 'app-header');
  const titleWrap = el('div', 'app-header-text');
  const h1 = el('h1', 'app-title');
  h1.append('EasyViewer', Object.assign(el('span', 'accent'), { textContent: 'PDF' }));
  titleWrap.appendChild(h1);
  titleWrap.appendChild(el('p', 'subtitle', 'Open a PDF and view its pages side by side.'));
  header.appendChild(titleWrap);
  page.appendChild(header);

  const controls = buildControls(views, handlers, () => renderLibrary(root, views, handlers));
  page.appendChild(controls.row);

  const visibleViews = getVisibleViews(views);
  const categories = getCategories(views);
  const visibleCategories = getCategories(visibleViews);
  const context = {
    handlers,
    categories,
    visibleViews,
    visibleViewIds: new Set(visibleViews.map((v) => v.id)),
    searchInput: controls.searchInput,
    rerender: () => renderLibrary(root, views, handlers),
  };

  if (libraryState.selectionMode) {
    page.appendChild(buildBulkBar(context));
  }

  const recent = [...visibleViews]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, RECENT_COUNT);
  page.appendChild(buildSection('Recent', recent, context, { withCreateTile: true }));

  for (const category of visibleCategories) {
    const inCategory = visibleViews.filter((v) => (v.category || '').trim() === category);
    page.appendChild(buildSection(category, inCategory, context, { category, categoryName: category }));
  }

  const uncategorized = visibleViews.filter((v) => !(v.category || '').trim());
  if (uncategorized.length) {
    page.appendChild(buildSection('Uncategorized', uncategorized, context, { category: '' }));
  }

  if (!visibleViews.length) {
    page.appendChild(el('p', 'empty-hint', 'No views match your current filters.'));
  }

  page.appendChild(buildAddCategoryDropZone(context));

  root.appendChild(page);

  if (libraryState.restoreSearchFocus) {
    controls.searchInput.focus();
    controls.searchInput.setSelectionRange(libraryState.searchSelectionStart, libraryState.searchSelectionEnd);
    libraryState.restoreSearchFocus = false;
  }

  removeShortcuts = installLibraryShortcuts(context);
}

function buildControls(allViews, handlers, rerender) {
  const row = el('div', 'library-controls');

  const search = el('input', 'library-search');
  search.type = 'search';
  search.placeholder = 'Search views or categories';
  search.value = libraryState.query;
  search.setAttribute('aria-label', 'Search views and categories');
  search.addEventListener('input', () => {
    libraryState.restoreSearchFocus = true;
    libraryState.searchSelectionStart = search.selectionStart ?? search.value.length;
    libraryState.searchSelectionEnd = search.selectionEnd ?? search.value.length;
    libraryState.query = search.value;
    rerender();
  });
  row.appendChild(search);

  const categorySelect = el('select', 'library-select');
  categorySelect.setAttribute('aria-label', 'Filter by category');
  appendOption(categorySelect, 'all', 'All categories');
  appendOption(categorySelect, 'uncategorized', 'Uncategorized');
  for (const category of getCategories(allViews)) {
    appendOption(categorySelect, category, category);
  }
  categorySelect.value = libraryState.categoryFilter;
  categorySelect.addEventListener('change', () => {
    libraryState.categoryFilter = categorySelect.value;
    rerender();
  });
  row.appendChild(categorySelect);

  const sortSelect = el('select', 'library-select');
  sortSelect.setAttribute('aria-label', 'Sort views');
  appendOption(sortSelect, 'recent', 'Newest first');
  appendOption(sortSelect, 'oldest', 'Oldest first');
  appendOption(sortSelect, 'name-asc', 'Name (A-Z)');
  appendOption(sortSelect, 'name-desc', 'Name (Z-A)');
  appendOption(sortSelect, 'category', 'Category');
  sortSelect.value = libraryState.sortBy;
  sortSelect.addEventListener('change', () => {
    libraryState.sortBy = sortSelect.value;
    rerender();
  });
  row.appendChild(sortSelect);

  const actions = el('div', 'library-actions');

  const createBtn = el('button', 'btn btn-primary');
  createBtn.type = 'button';
  createBtn.textContent = 'New view';
  createBtn.addEventListener('click', handlers.onCreate);
  actions.appendChild(createBtn);

  const menuBtn = el('button', 'btn');
  menuBtn.type = 'button';
  menuBtn.textContent = 'Library menu';
  menuBtn.addEventListener('click', () => {
    const rect = menuBtn.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 6, [
      {
        label: libraryState.selectionMode ? 'Exit selection mode' : 'Select views',
        onClick: () => {
          libraryState.selectionMode = !libraryState.selectionMode;
          if (!libraryState.selectionMode) libraryState.selectedIds.clear();
          rerender();
        },
      },
      { separator: true },
      { label: 'Open storage folder', onClick: () => window.api.revealLibrary() },
      { label: 'Export metadata', onClick: handlers.onExportMetadata },
      { label: 'Import metadata', onClick: handlers.onImportMetadata },
    ]);
  });
  actions.appendChild(menuBtn);

  row.appendChild(actions);

  return { row, searchInput: search };
}

function appendOption(select, value, label) {
  const option = el('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function getCategories(views) {
  return [...new Set(views.map((v) => (v.category || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function getVisibleViews(views) {
  const query = libraryState.query.trim().toLowerCase();
  const categoryFilter = libraryState.categoryFilter;

  let next = views.filter((view) => {
    const category = (view.category || '').trim();
    if (categoryFilter === 'uncategorized' && category) return false;
    if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && category !== categoryFilter) {
      return false;
    }

    if (!query) return true;
    const haystack = [view.name || '', category, formatDate(view.createdAt)].join(' ').toLowerCase();
    return haystack.includes(query);
  });

  next = [...next];
  switch (libraryState.sortBy) {
    case 'oldest':
      next.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      break;
    case 'name-asc':
      next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      break;
    case 'name-desc':
      next.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
      break;
    case 'category':
      next.sort((a, b) => {
        const aCategory = (a.category || '').trim();
        const bCategory = (b.category || '').trim();
        const categoryCmp = aCategory.localeCompare(bCategory);
        if (categoryCmp) return categoryCmp;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      break;
    case 'recent':
    default:
      next.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      break;
  }

  return next;
}

function buildBulkBar(context) {
  const bar = el('div', 'bulk-bar');
  const selectedIds = [...libraryState.selectedIds].filter((id) => context.visibleViewIds.has(id));
  const countLabel = el('span', 'bulk-count', `${selectedIds.length} selected`);
  bar.appendChild(countLabel);

  const moveBtn = el('button', 'btn');
  moveBtn.type = 'button';
  moveBtn.textContent = 'Move to category';
  moveBtn.disabled = selectedIds.length === 0;
  moveBtn.addEventListener('click', async () => {
    const name = await promptDialog({
      title: 'Move selected views',
      message: 'Category name',
      value: '',
      confirmLabel: 'Move',
    });
    if (!name) return;
    await context.handlers.onBulkSetCategory(selectedIds, name);
    libraryState.selectedIds.clear();
  });
  bar.appendChild(moveBtn);

  const deleteBtn = el('button', 'btn btn-danger');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete selected';
  deleteBtn.disabled = selectedIds.length === 0;
  deleteBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete views',
      message: `Delete ${selectedIds.length} selected view(s)?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await context.handlers.onBulkDelete(selectedIds);
    libraryState.selectedIds.clear();
  });
  bar.appendChild(deleteBtn);

  const moreBtn = el('button', 'btn');
  moreBtn.type = 'button';
  moreBtn.textContent = 'More';
  moreBtn.disabled = selectedIds.length === 0;
  moreBtn.addEventListener('click', () => {
    const rect = moreBtn.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 6, [
      {
        label: 'Remove category',
        onClick: async () => {
          await context.handlers.onBulkRemoveCategory(selectedIds);
          libraryState.selectedIds.clear();
        },
      },
      {
        label: 'Clear selection',
        onClick: () => {
          libraryState.selectedIds.clear();
          context.rerender();
        },
      },
      {
        label: 'Exit selection mode',
        onClick: () => {
          libraryState.selectedIds.clear();
          libraryState.selectionMode = false;
          context.rerender();
        },
      },
    ]);
  });
  bar.appendChild(moreBtn);

  return bar;
}

function buildSection(title, views, context, { withCreateTile = false, category = null, categoryName = '' } = {}) {
  const section = el('section', 'library-section');

  const titleRow = el('div', 'section-title-row');
  titleRow.appendChild(el('h2', 'section-title', title));
  if (categoryName) {
    const tools = el('div', 'section-tools');
    tools.appendChild(
      iconButton('Rename category', '✎', async () => {
        const next = await promptDialog({
          title: 'Rename category',
          message: `Rename “${categoryName}”`,
          value: categoryName,
          confirmLabel: 'Rename',
        });
        if (next && next !== categoryName) {
          await context.handlers.onRenameCategory(categoryName, next);
        }
      })
    );
    tools.appendChild(
      iconButton('Delete category', '🗑', async () => {
        const ok = await confirmDialog({
          title: 'Delete category',
          message: `Delete category “${categoryName}”? Views will become uncategorized.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (ok) await context.handlers.onDeleteCategory(categoryName);
      }, 'icon-btn-danger')
    );
    titleRow.appendChild(tools);
  }
  section.appendChild(titleRow);

  const grid = el('div', 'library-grid');
  section.appendChild(grid);

  if (category !== null) {
    installDropTarget(section, grid, category, context);
  }

  if (withCreateTile) {
    const createTile = el('button', 'tile tile-create');
    createTile.type = 'button';
    createTile.setAttribute('aria-label', 'Create a new view from a PDF');
    const plus = el('span', 'plus', '+');
    plus.setAttribute('aria-hidden', 'true');
    createTile.appendChild(plus);
    createTile.appendChild(el('span', 'tile-create-label', 'New view'));
    createTile.addEventListener('click', context.handlers.onCreate);
    grid.appendChild(createTile);
  }

  if (!views.length && !withCreateTile) {
    grid.appendChild(el('p', 'empty-hint', 'No views here yet.'));
  }

  for (const view of views) grid.appendChild(buildViewTile(view, context));
  return section;
}

function buildViewTile(view, context) {
  const { handlers } = context;
  const selected = libraryState.selectedIds.has(view.id);
  const tile = el('article', `tile tile-view${selected ? ' is-selected' : ''}`);
  tile.draggable = !libraryState.selectionMode;

  tile.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer || libraryState.selectionMode) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', view.id);
    tile.classList.add('is-dragging');
  });

  tile.addEventListener('dragend', () => {
    tile.classList.remove('is-dragging');
  });

  if (libraryState.selectionMode) {
    const selector = el('label', 'tile-selector');
    const checkbox = el('input', 'tile-select');
    checkbox.type = 'checkbox';
    checkbox.checked = selected;
    checkbox.setAttribute('aria-label', `Select ${view.name}`);
    checkbox.addEventListener('change', () => {
      toggleSelection(view.id);
      context.rerender();
    });
    selector.appendChild(checkbox);
    tile.appendChild(selector);
  }

  const open = el('button', 'tile-open');
  open.type = 'button';
  open.setAttribute('aria-label', `Open view: ${view.name}`);

  const thumb = el('div', 'thumb is-loading');
  thumb.appendChild(el('div', 'thumb-loading', 'Loading…'));
  open.appendChild(thumb);

  const meta = el('div', 'tile-meta');
  meta.appendChild(el('span', 'tile-title', view.name));
  const sub = el('div', 'tile-sub');
  sub.appendChild(el('span', 'tile-date', formatDate(view.createdAt)));
  if ((view.category || '').trim()) {
    sub.appendChild(el('span', 'tile-tag', view.category.trim()));
  }
  meta.appendChild(sub);
  open.appendChild(meta);

  open.addEventListener('click', (e) => {
    if (libraryState.selectionMode || e.ctrlKey || e.metaKey) {
      if (!libraryState.selectionMode) libraryState.selectionMode = true;
      toggleSelection(view.id);
      context.rerender();
      return;
    }
    handlers.onOpen(view.id);
  });
  tile.appendChild(open);

  if (!libraryState.selectionMode) {
    const actions = el('div', 'tile-actions');
    actions.appendChild(
      iconButton('More options', '⋯', () => {
        const rect = tile.getBoundingClientRect();
        showViewMenu(rect.right - 8, rect.top + 32, view, context);
      })
    );
    tile.appendChild(actions);

    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showViewMenu(e.clientX, e.clientY, view, context);
    });
  }

  loadThumb(view.id, thumb);
  return tile;
}

function toggleSelection(id) {
  if (libraryState.selectedIds.has(id)) libraryState.selectedIds.delete(id);
  else libraryState.selectedIds.add(id);
}

function pruneSelection(views) {
  const ids = new Set(views.map((v) => v.id));
  for (const id of [...libraryState.selectedIds]) {
    if (!ids.has(id)) libraryState.selectedIds.delete(id);
  }
}

function installDropTarget(section, grid, category, context) {
  let dragDepth = 0;

  const setActive = (active) => {
    section.classList.toggle('is-drop-target', active);
    grid.classList.toggle('is-drop-target', active);
  };

  const clearDropState = () => {
    dragDepth = 0;
    setActive(false);
  };

  const onDragEnter = (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    dragDepth += 1;
    setActive(true);
  };

  const onDragOver = (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDragLeave = (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && !section.contains(e.relatedTarget)) {
      setActive(false);
    }
  };

  const onDrop = async (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    e.preventDefault();
    const viewId = e.dataTransfer.getData('text/plain');
    clearDropState();
    if (!viewId) return;
    if (category === '') {
      await context.handlers.onRemoveCategory(viewId);
    } else {
      await context.handlers.onSetCategory(viewId, category);
    }
  };

  section.addEventListener('dragenter', onDragEnter);
  section.addEventListener('dragover', onDragOver);
  section.addEventListener('dragleave', onDragLeave);
  section.addEventListener('drop', onDrop);
  section.addEventListener('dragend', clearDropState);
}

function buildAddCategoryDropZone(context) {
  const section = el('section', 'library-section add-category-section');
  section.appendChild(el('h2', 'section-title', 'Add category'));

  const zone = el('button', 'add-category-dropzone');
  zone.type = 'button';
  zone.textContent = 'Drop a view here to create a category';
  zone.setAttribute('aria-label', 'Drop a view here to create a new category');

  let dragDepth = 0;
  const setActive = (active) => {
    section.classList.toggle('is-drop-target', active);
    zone.classList.toggle('is-drop-target', active);
  };
  const clearDropState = () => {
    dragDepth = 0;
    setActive(false);
  };

  const onDragEnter = (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    dragDepth += 1;
    setActive(true);
  };

  const onDragOver = (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDragLeave = (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && !section.contains(e.relatedTarget)) {
      setActive(false);
    }
  };

  const onDrop = async (e) => {
    if (!e.dataTransfer?.types.includes('text/plain') || libraryState.selectionMode) return;
    e.preventDefault();
    const viewId = e.dataTransfer.getData('text/plain');
    clearDropState();
    if (!viewId) return;

    const name = await promptDialog({
      title: 'Add category',
      message: 'Category name',
      value: '',
      confirmLabel: 'Create',
    });
    if (name) {
      await context.handlers.onSetCategory(viewId, name);
    }
  };

  zone.addEventListener('dragenter', onDragEnter);
  zone.addEventListener('dragover', onDragOver);
  zone.addEventListener('dragleave', onDragLeave);
  zone.addEventListener('drop', onDrop);
  zone.addEventListener('dragend', clearDropState);

  section.appendChild(zone);
  return section;
}

function showViewMenu(x, y, view, context) {
  const { handlers, categories } = context;
  const currentCategory = (view.category || '').trim();
  const hasCategory = Boolean(currentCategory);
  const others = categories.filter((c) => c !== currentCategory);

  const items = [];

  items.push({
    label: 'Copy PDF path',
    onClick: () => window.api.copyViewPdfPath(view.id),
  });
  items.push({
    label: 'Reveal PDF in folder',
    onClick: () => handlers.onRevealPdf(view.id),
  });
  items.push({ separator: true });

  for (const category of others) {
    items.push({ label: `Move to “${category}”`, onClick: () => handlers.onSetCategory(view.id, category) });
  }
  items.push({ label: 'Add to category…', onClick: () => promptCategory(view, handlers) });
  if (hasCategory) {
    items.push({ label: 'Remove from category', onClick: () => handlers.onRemoveCategory(view.id) });
    items.push({
      label: 'Edit category name…',
      onClick: async () => {
        const next = await promptDialog({
          title: 'Edit category',
          message: `Rename the category “${currentCategory}” (applies to every view in it)`,
          value: currentCategory,
        });
        if (next && next !== currentCategory) handlers.onRenameCategory(currentCategory, next);
      },
    });
  }
  items.push({ separator: true });
  items.push({
    label: 'Rename view…',
    onClick: async () => {
      const name = await promptDialog({ title: 'Rename view', message: 'New name', value: view.name });
      if (name) handlers.onRename(view.id, name);
    },
  });
  items.push({
    label: 'Delete view',
    danger: true,
    onClick: async () => {
      const ok = await confirmDialog({
        title: 'Delete view',
        message: `Delete “${view.name}”? This permanently removes the stored copy of the PDF.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) handlers.onDelete(view.id);
    },
  });

  openContextMenu(x, y, items);
}

async function promptCategory(view, handlers) {
  const name = await promptDialog({
    title: 'Add to category',
    message: 'Category name (e.g. Guitar, Work)',
    value: (view.category || '').trim(),
    confirmLabel: 'Apply',
  });
  if (name) handlers.onSetCategory(view.id, name);
}

function installLibraryShortcuts(context) {
  const onKeydown = (e) => {
    if (isOverlayOpen()) return;

    const target = e.target;
    const isTextEntry =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

    const combo = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (combo && key === 'f') {
      e.preventDefault();
      context.searchInput.focus();
      context.searchInput.select();
      return;
    }

    if (combo && key === 'n') {
      e.preventDefault();
      context.handlers.onCreate();
      return;
    }

    if (combo && key === 'e') {
      e.preventDefault();
      context.handlers.onExportMetadata();
      return;
    }

    if (combo && key === 'i') {
      e.preventDefault();
      context.handlers.onImportMetadata();
      return;
    }

    if (isTextEntry) return;

    if (combo && key === 'a' && libraryState.selectionMode) {
      e.preventDefault();
      for (const view of context.visibleViews) {
        libraryState.selectedIds.add(view.id);
      }
      context.rerender();
      return;
    }

    if (e.key === 'Escape' && libraryState.selectionMode) {
      e.preventDefault();
      libraryState.selectedIds.clear();
      libraryState.selectionMode = false;
      context.rerender();
      return;
    }

    if (e.key === 'Delete' && libraryState.selectionMode && libraryState.selectedIds.size) {
      e.preventDefault();
      context.handlers.onBulkDelete([...libraryState.selectedIds]);
      return;
    }
  };

  document.addEventListener('keydown', onKeydown, true);
  return () => document.removeEventListener('keydown', onKeydown, true);
}

// Cache rendered thumbnails (as data URLs) by view id so re-rendering the
// library after updates reuses them instantly.
const thumbCache = new Map();

function pruneThumbCache(views) {
  const ids = new Set(views.map((v) => v.id));
  for (const key of thumbCache.keys()) {
    if (!ids.has(key)) thumbCache.delete(key);
  }
}

function makeThumbImage(dataUrl) {
  const img = el('img', 'thumb-canvas');
  img.src = dataUrl;
  img.setAttribute('role', 'img');
  img.setAttribute('alt', 'First page preview');
  return img;
}

async function loadThumb(id, thumbEl) {
  const cached = thumbCache.get(id);
  if (cached) {
    clear(thumbEl);
    thumbEl.classList.remove('is-loading');
    thumbEl.appendChild(makeThumbImage(cached));
    return;
  }
  try {
    const bytes = await window.api.getViewPdf(id);
    const pdf = await loadPdf(bytes);
    const { canvas } = await renderPage(pdf, 1, 360);
    const dataUrl = canvas.toDataURL('image/png');
    thumbCache.set(id, dataUrl);
    clear(thumbEl);
    thumbEl.classList.remove('is-loading');
    thumbEl.appendChild(makeThumbImage(dataUrl));
  } catch {
    clear(thumbEl);
    thumbEl.classList.remove('is-loading');
    thumbEl.appendChild(el('div', 'thumb-error', 'No preview'));
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

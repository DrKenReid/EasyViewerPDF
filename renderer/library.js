// The library screen: a grid of saved views with search, sorting, tags,
// multi-select bulk actions, drag/drop tagging, collapsible + reorderable
// tag sections.

import { el, clear, iconButton } from './dom.js';
import { loadPdf, renderPage } from './pdfutil.js';
import { confirmDialog, promptDialog, tagDialog, openContextMenu, isOverlayOpen } from './ui.js';

const RECENT_COUNT = 8;
const COLLAPSE_KEY = 'easyviewerpdf.collapsedSections';
const TAG_REORDER_TYPE = 'application/x-tag-reorder';

const libraryState = {
  query: '',
  tagFilter: 'all',
  sortBy: 'recent',
  selectionMode: false,
  selectedIds: new Set(),
  restoreSearchFocus: false,
  searchSelectionStart: 0,
  searchSelectionEnd: 0,
  isImporting: false,
};

let removeShortcuts = null;

/**
 * @param {HTMLElement} root
 * @param {Array} views
 * @param {{sectionSort: string, tags: Array}} config
 * @param {object} handlers
 */
export function renderLibrary(root, views, config, handlers) {
  if (removeShortcuts) {
    removeShortcuts();
    removeShortcuts = null;
  }

  pruneSelection(views);
  pruneThumbCache(views);

  clear(root);

  const tagsById = new Map(config.tags.map((t) => [t.id, t]));
  if (libraryState.tagFilter !== 'all' && libraryState.tagFilter !== 'untagged' && !tagsById.has(libraryState.tagFilter)) {
    libraryState.tagFilter = 'all';
  }

  const page = el('div', 'library');

  const header = el('header', 'app-header');
  const titleWrap = el('div', 'app-header-text');
  const h1 = el('h1', 'app-title');
  h1.append('EasyViewer', Object.assign(el('span', 'accent'), { textContent: 'PDF' }));
  titleWrap.appendChild(h1);
  titleWrap.appendChild(el('p', 'subtitle', 'Open a PDF and view its pages side by side.'));
  header.appendChild(titleWrap);
  page.appendChild(header);

  const rerender = () => renderLibrary(root, views, config, handlers);
  const controls = buildControls(config, tagsById, handlers, rerender);
  page.appendChild(controls.row);

  const visibleViews = getVisibleViews(views, tagsById);
  const context = {
    handlers,
    config,
    tagsById,
    orderedTagIds: config.tags.map((t) => t.id),
    visibleViews,
    visibleViewIds: new Set(visibleViews.map((v) => v.id)),
    searchInput: controls.searchInput,
    rerender,
  };

  installPageFileDrop(page, context);
  installMarqueeSelection(page, context);

  if (libraryState.selectionMode) {
    page.appendChild(buildBulkBar(context));
  }

  const recent = [...visibleViews]
    .filter((v) => v.lastOpenedAt)
    .sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
    .slice(0, RECENT_COUNT);
  page.appendChild(
    buildSection(context, { key: 'recent', title: 'Recent', views: recent, withCreateTile: true })
  );

  const filtering = Boolean(libraryState.query.trim()) || libraryState.tagFilter !== 'all';
  for (const tag of orderTagsForDisplay(config, visibleViews, tagsById)) {
    const inTag = visibleViews.filter((v) => v.tags.includes(tag.id));
    if (filtering && !inTag.length) continue;
    page.appendChild(
      buildSection(context, {
        key: tag.id,
        tag,
        views: inTag,
        dropTarget: { kind: 'tag', tagId: tag.id },
      })
    );
  }

  const untagged = visibleViews.filter((v) => !v.tags.length);
  if (untagged.length) {
    page.appendChild(
      buildSection(context, {
        key: 'untagged',
        title: 'Untagged',
        views: untagged,
        dropTarget: { kind: 'untagged' },
      })
    );
  }

  if (!visibleViews.length) {
    page.appendChild(el('p', 'empty-hint', 'No views match your current filters.'));
  }

  page.appendChild(buildAddTagDropZone(context));

  root.appendChild(page);

  if (libraryState.restoreSearchFocus) {
    controls.searchInput.focus();
    controls.searchInput.setSelectionRange(libraryState.searchSelectionStart, libraryState.searchSelectionEnd);
    libraryState.restoreSearchFocus = false;
  }

  removeShortcuts = installLibraryShortcuts(context);
}

function buildControls(config, tagsById, handlers, rerender) {
  const row = el('div', 'library-controls');

  const search = el('input', 'library-search');
  search.type = 'search';
  search.placeholder = 'Search views or tags';
  search.value = libraryState.query;
  search.setAttribute('aria-label', 'Search views and tags');
  search.addEventListener('input', () => {
    libraryState.restoreSearchFocus = true;
    libraryState.searchSelectionStart = search.selectionStart ?? search.value.length;
    libraryState.searchSelectionEnd = search.selectionEnd ?? search.value.length;
    libraryState.query = search.value;
    rerender();
  });
  row.appendChild(search);

  const tagSelect = el('select', 'library-select');
  tagSelect.setAttribute('aria-label', 'Filter by tag');
  appendOption(tagSelect, 'all', 'All tags');
  appendOption(tagSelect, 'untagged', 'Untagged');
  for (const tag of config.tags) appendOption(tagSelect, tag.id, tagDisplayName(tag));
  tagSelect.value = libraryState.tagFilter;
  tagSelect.addEventListener('change', () => {
    libraryState.tagFilter = tagSelect.value;
    rerender();
  });
  row.appendChild(tagSelect);

  const sortSelect = el('select', 'library-select');
  sortSelect.setAttribute('aria-label', 'Sort views within sections');
  appendOption(sortSelect, 'recent', 'Newest first');
  appendOption(sortSelect, 'oldest', 'Oldest first');
  appendOption(sortSelect, 'name-asc', 'Name (A-Z)');
  appendOption(sortSelect, 'name-desc', 'Name (Z-A)');
  sortSelect.value = libraryState.sortBy;
  sortSelect.addEventListener('change', () => {
    libraryState.sortBy = sortSelect.value;
    rerender();
  });
  row.appendChild(sortSelect);

  const sectionSelect = el('select', 'library-select');
  sectionSelect.setAttribute('aria-label', 'Order tag sections');
  appendOption(sectionSelect, 'manual', 'Sections: manual');
  appendOption(sectionSelect, 'recent', 'Sections: by recency');
  appendOption(sectionSelect, 'alpha', 'Sections: alphabetical');
  sectionSelect.value = config.sectionSort;
  sectionSelect.addEventListener('change', async () => {
    await handlers.onSetSectionSort(sectionSelect.value);
  });
  row.appendChild(sectionSelect);

  const actions = el('div', 'library-actions');

  const openImportMenu = (anchor) => {
    const rect = anchor.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 6, buildImportMenuItems(config.tags, handlers));
  };

  const createBtn = el('button', 'btn btn-primary');
  createBtn.type = 'button';
  createBtn.textContent = 'New view';
  createBtn.addEventListener('click', () => openImportMenu(createBtn));
  actions.appendChild(createBtn);

  const menuBtn = el('button', 'btn');
  menuBtn.type = 'button';
  menuBtn.textContent = 'Library menu';
  menuBtn.addEventListener('click', () => {
    const rect = menuBtn.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 6, [
      {
        label: 'New tag…',
        onClick: async () => {
          const def = await tagDialog({ title: 'New tag' });
          if (def) await handlers.onCreateTag(def);
        },
      },
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

function tagDisplayName(tag) {
  return tag.name || `Color ${tag.color}`;
}

function getVisibleViews(views, tagsById) {
  const query = libraryState.query.trim().toLowerCase();
  const tagFilter = libraryState.tagFilter;

  let next = views.filter((view) => {
    const tags = view.tags || [];
    if (tagFilter === 'untagged' && tags.length) return false;
    if (tagFilter !== 'all' && tagFilter !== 'untagged' && !tags.includes(tagFilter)) return false;

    if (!query) return true;
    const tagNames = tags.map((id) => tagsById.get(id)?.name || '').join(' ');
    const haystack = [view.name || '', tagNames, formatDate(view.createdAt)].join(' ').toLowerCase();
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
    case 'recent':
    default:
      next.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      break;
  }

  return next;
}

// Order tag sections according to the library's sectionSort preference.
function orderTagsForDisplay(config, visibleViews, tagsById) {
  const tags = [...config.tags];
  if (config.sectionSort === 'alpha') {
    return tags.sort((a, b) => tagDisplayName(a).localeCompare(tagDisplayName(b)));
  }
  if (config.sectionSort === 'recent') {
    const newest = new Map();
    for (const view of visibleViews) {
      for (const id of view.tags) {
        const at = String(view.createdAt);
        if (!newest.has(id) || at > newest.get(id)) newest.set(id, at);
      }
    }
    return tags.sort((a, b) => {
      const av = newest.get(a.id) || '';
      const bv = newest.get(b.id) || '';
      if (av === bv) return tagDisplayName(a).localeCompare(tagDisplayName(b));
      return bv.localeCompare(av);
    });
  }
  return tags; // manual — already in registry order
}

// --- Collapse state (persisted UI preference) ------------------------------

function getCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function setCollapsed(key, collapsed) {
  const set = getCollapsed();
  if (collapsed) set.add(key);
  else set.delete(key);
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
}

function buildBulkBar(context) {
  const bar = el('div', 'bulk-bar');
  const selectedIds = [...libraryState.selectedIds].filter((id) => context.visibleViewIds.has(id));
  const countLabel = el('span', 'bulk-count', `${selectedIds.length} selected`);
  bar.appendChild(countLabel);

  const addBtn = el('button', 'btn');
  addBtn.type = 'button';
  addBtn.textContent = 'Add tag';
  addBtn.disabled = selectedIds.length === 0;
  addBtn.addEventListener('click', () => {
    const rect = addBtn.getBoundingClientRect();
    const items = context.config.tags.map((tag) => ({
      label: `Add “${tagDisplayName(tag)}”`,
      onClick: async () => {
        await context.handlers.onBulkAddTag(selectedIds, tag.id);
        libraryState.selectedIds.clear();
      },
    }));
    items.push({ separator: true });
    items.push({
      label: 'New tag…',
      onClick: async () => {
        const def = await tagDialog({ title: 'New tag' });
        if (!def) return;
        const tag = await context.handlers.onCreateTag(def);
        if (tag) await context.handlers.onBulkAddTag(selectedIds, tag.id);
        libraryState.selectedIds.clear();
      },
    });
    openContextMenu(rect.left, rect.bottom + 6, items);
  });
  bar.appendChild(addBtn);

  const removeBtn = el('button', 'btn');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove tag';
  const tagsInSelection = collectTags(selectedIds, context);
  removeBtn.disabled = tagsInSelection.length === 0;
  removeBtn.addEventListener('click', () => {
    const rect = removeBtn.getBoundingClientRect();
    openContextMenu(
      rect.left,
      rect.bottom + 6,
      tagsInSelection.map((tag) => ({
        label: `Remove “${tagDisplayName(tag)}”`,
        onClick: async () => {
          await context.handlers.onBulkRemoveTag(selectedIds, tag.id);
          libraryState.selectedIds.clear();
        },
      }))
    );
  });
  bar.appendChild(removeBtn);

  const clearBtn = el('button', 'btn');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear tags';
  clearBtn.disabled = tagsInSelection.length === 0;
  clearBtn.addEventListener('click', async () => {
    await context.handlers.onBulkClearTags(selectedIds);
    libraryState.selectedIds.clear();
  });
  bar.appendChild(clearBtn);

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
  moreBtn.addEventListener('click', () => {
    const rect = moreBtn.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 6, [
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

// The distinct tags currently applied across a set of view ids.
function collectTags(ids, context) {
  const idSet = new Set(ids);
  const seen = new Set();
  const tags = [];
  for (const view of context.visibleViews) {
    if (!idSet.has(view.id)) continue;
    for (const tagId of view.tags) {
      if (seen.has(tagId)) continue;
      const tag = context.tagsById.get(tagId);
      if (tag) {
        seen.add(tagId);
        tags.push(tag);
      }
    }
  }
  return tags;
}

function buildSection(context, { key, title = '', tag = null, views, withCreateTile = false, dropTarget = null } = {}) {
  const collapsed = getCollapsed().has(key);
  const section = el('section', 'library-section' + (collapsed ? ' is-collapsed' : ''));

  const titleRow = el('div', 'section-title-row');

  const toggle = el('button', 'section-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  const caret = el('span', 'section-caret', '▾');
  caret.setAttribute('aria-hidden', 'true');
  toggle.appendChild(caret);
  if (tag) toggle.appendChild(buildTagChip(tag, 'section-tag-chip'));
  else toggle.appendChild(el('span', 'section-title', title));
  toggle.appendChild(el('span', 'section-count', String(views.length)));
  toggle.addEventListener('click', () => {
    setCollapsed(key, !section.classList.contains('is-collapsed'));
    context.rerender();
  });
  titleRow.appendChild(toggle);

  if (tag) {
    const tools = el('div', 'section-tools');
    tools.appendChild(
      iconButton('Edit tag', '✎', async () => {
        const def = await tagDialog({ title: 'Edit tag', name: tag.name, color: tag.color });
        if (def) await context.handlers.onUpdateTag(tag.id, def);
      })
    );
    tools.appendChild(
      iconButton(
        'Delete tag',
        '🗑',
        async () => {
          const ok = await confirmDialog({
            title: 'Delete tag',
            message: `Delete the tag “${tagDisplayName(tag)}”? Views keep their other tags.`,
            confirmLabel: 'Delete',
            danger: true,
          });
          if (ok) await context.handlers.onDeleteTag(tag.id);
        },
        'icon-btn-danger'
      )
    );
    titleRow.appendChild(tools);

    if (context.config.sectionSort === 'manual') {
      installSectionReorder(section, titleRow, tag.id, context);
    }
  }

  section.appendChild(titleRow);

  const grid = el('div', 'library-grid');
  section.appendChild(grid);

  if (dropTarget) installDropTarget(section, grid, dropTarget, context);

  if (withCreateTile) {
    const createTile = el('button', 'tile tile-create');
    createTile.type = 'button';
    createTile.setAttribute('aria-label', 'Create a new view from a PDF');
    const plus = el('span', 'plus', '+');
    plus.setAttribute('aria-hidden', 'true');
    createTile.appendChild(plus);
    createTile.appendChild(el('span', 'tile-create-label', 'New view'));
    createTile.addEventListener('click', () => {
      const rect = createTile.getBoundingClientRect();
      openContextMenu(rect.left, rect.bottom + 6, buildImportMenuItems(context.config.tags, context.handlers));
    });
    grid.appendChild(createTile);
  }

  if (!views.length && !withCreateTile) {
    grid.appendChild(el('p', 'empty-hint', 'No views here yet.'));
  }

  for (const view of views) grid.appendChild(buildViewTile(view, context));
  return section;
}

// Pick a legible text color for a chip given its background luminance.
function readableText(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return '';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#16181d' : '#ffffff';
}

function buildTagChip(tag, extraClass = '') {
  const named = Boolean(tag.name);
  const chip = el('span', 'tag-chip' + (named ? '' : ' tag-chip-color') + (extraClass ? ' ' + extraClass : ''));
  if (!named) {
    // A color-only tag renders as a pure swatch.
    if (tag.color) {
      chip.style.background = tag.color;
      chip.style.borderColor = tag.color;
      chip.title = tag.color;
    }
    return chip;
  }
  if (tag.color) {
    // Fill the chip with the tag color and pick a legible text color.
    chip.style.background = tag.color;
    chip.style.borderColor = tag.color;
    const text = readableText(tag.color);
    if (text) chip.style.color = text;
  }
  chip.append(tag.name);
  return chip;
}

function viewTags(view, context) {
  return view.tags.map((id) => context.tagsById.get(id)).filter(Boolean);
}

function buildViewTile(view, context) {
  const { handlers } = context;
  const selected = libraryState.selectedIds.has(view.id);
  const tile = el('article', `tile tile-view${selected ? ' is-selected' : ''}`);
  tile.dataset.viewId = view.id;
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
  const tags = viewTags(view, context);
  if (tags.length) {
    const tagWrap = el('div', 'tile-tags');
    for (const tag of tags) tagWrap.appendChild(buildTagChip(tag));
    sub.appendChild(tagWrap);
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

function hasInternalViewDrag(dataTransfer) {
  return Boolean(dataTransfer?.types?.includes('text/plain'));
}

function hasFileDrag(dataTransfer) {
  return Boolean(dataTransfer?.types?.includes('Files'));
}

function hasTagReorderDrag(dataTransfer) {
  return Boolean(dataTransfer?.types?.includes(TAG_REORDER_TYPE));
}

function getDroppedPdfPaths(dataTransfer) {
  if (!dataTransfer?.files?.length) return [];
  return Array.from(dataTransfer.files)
    .map((file) => resolveFilePath(file))
    .filter((p) => typeof p === 'string' && p.toLowerCase().endsWith('.pdf'));
}

function resolveFilePath(file) {
  // Electron 32+ removed File.path; prefer the webUtils-backed bridge and
  // fall back to the legacy property for older runtimes.
  if (window.api && typeof window.api.getPathForFile === 'function') {
    const resolved = window.api.getPathForFile(file);
    if (resolved) return resolved;
  }
  return file?.path || '';
}

function prepareLibraryForImportedViews(tags) {
  const target = new Set(tags || []);
  if (libraryState.query) {
    libraryState.query = '';
  }

  const filter = libraryState.tagFilter;
  if (filter === 'all') return;
  if (filter === 'untagged' && target.size === 0) return;
  if (target.has(filter)) return;

  libraryState.tagFilter = 'all';
}

// Guard against overlapping imports. A single drop can bubble through multiple
// drop targets (e.g. a section and the page), so without this the same files
// would be imported more than once and the racing re-renders could appear to
// hang the UI.
async function runFileImport(context, paths, tags) {
  if (libraryState.isImporting) return;
  if (!paths.length) return;

  libraryState.isImporting = true;
  try {
    prepareLibraryForImportedViews(tags);
    await context.handlers.onImportFiles(paths, tags);
  } finally {
    libraryState.isImporting = false;
  }
}

function installPageFileDrop(page, context) {
  const onDragOver = (e) => {
    if (libraryState.selectionMode) return;
    if (!hasFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = async (e) => {
    if (libraryState.selectionMode) return;
    if (!hasFileDrag(e.dataTransfer)) return;

    e.preventDefault();
    const paths = getDroppedPdfPaths(e.dataTransfer);
    await runFileImport(context, paths, []);
  };

  page.addEventListener('dragover', onDragOver);
  page.addEventListener('drop', onDrop);
}

// Rubber-band (marquee) selection: drag across empty space to select multiple
// views without first opening the library menu's "Select views" mode.
function installMarqueeSelection(page, context) {
  const THRESHOLD = 5;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let marquee = null;
  let baseSelection = new Set();

  const tiles = () => Array.from(page.querySelectorAll('.tile-view'));

  const isInteractive = (target) =>
    target instanceof Element &&
    target.closest(
      '.tile, button, a, input, select, textarea, .library-controls, .bulk-bar, .add-tag-dropzone, .section-tools, .section-toggle'
    );

  const rectFrom = (x, y) => ({
    left: Math.min(startX, x),
    top: Math.min(startY, y),
    right: Math.max(startX, x),
    bottom: Math.max(startY, y),
  });

  const applyMarquee = (rect) => {
    const selected = new Set(baseSelection);
    for (const tile of tiles()) {
      const r = tile.getBoundingClientRect();
      const hit = !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom);
      tile.classList.toggle('is-marquee', hit);
      if (hit && tile.dataset.viewId) selected.add(tile.dataset.viewId);
    }
    libraryState.selectedIds = selected;
  };

  const onMouseMove = (e) => {
    if (!moved && Math.abs(e.clientX - startX) < THRESHOLD && Math.abs(e.clientY - startY) < THRESHOLD) {
      return;
    }
    moved = true;
    document.body.classList.add('is-marqueeing');
    if (!marquee) {
      marquee = document.createElement('div');
      marquee.className = 'marquee';
      document.body.appendChild(marquee);
    }
    const rect = rectFrom(e.clientX, e.clientY);
    marquee.style.left = `${rect.left}px`;
    marquee.style.top = `${rect.top}px`;
    marquee.style.width = `${rect.right - rect.left}px`;
    marquee.style.height = `${rect.bottom - rect.top}px`;
    applyMarquee(rect);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.classList.remove('is-marqueeing');
    if (marquee) {
      marquee.remove();
      marquee = null;
    }
    for (const tile of tiles()) tile.classList.remove('is-marquee');

    if (moved && libraryState.selectedIds.size > 0) {
      libraryState.selectionMode = true;
      context.rerender();
    }
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (isInteractive(e.target)) return;

    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    baseSelection =
      e.shiftKey || e.ctrlKey || e.metaKey ? new Set(libraryState.selectedIds) : new Set();

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  page.addEventListener('mousedown', onMouseDown);
}

// Drag a tag section's header onto another to reorder sections (manual mode).
function installSectionReorder(section, handle, tagId, context) {
  handle.draggable = true;
  section.classList.add('is-reorderable');

  handle.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer || libraryState.selectionMode) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TAG_REORDER_TYPE, tagId);
    section.classList.add('is-reordering');
  });
  handle.addEventListener('dragend', () => section.classList.remove('is-reordering'));

  const onDragOver = (e) => {
    if (!hasTagReorderDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    section.classList.add('is-reorder-target');
  };
  const onDragLeave = (e) => {
    if (!section.contains(e.relatedTarget)) section.classList.remove('is-reorder-target');
  };
  const onDrop = async (e) => {
    if (!hasTagReorderDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    section.classList.remove('is-reorder-target');
    const dragged = e.dataTransfer.getData(TAG_REORDER_TYPE);
    if (!dragged || dragged === tagId) return;

    const order = context.orderedTagIds.filter((id) => id !== dragged);
    const targetIndex = order.indexOf(tagId);
    order.splice(targetIndex < 0 ? order.length : targetIndex, 0, dragged);
    await context.handlers.onReorderTags(order);
  };

  section.addEventListener('dragover', onDragOver);
  section.addEventListener('dragleave', onDragLeave);
  section.addEventListener('drop', onDrop);
}

function installDropTarget(section, grid, target, context) {
  let dragDepth = 0;

  const accepts = (dt) => hasInternalViewDrag(dt) || hasFileDrag(dt);

  const setActive = (active) => {
    section.classList.toggle('is-drop-target', active);
    grid.classList.toggle('is-drop-target', active);
  };

  const clearDropState = () => {
    dragDepth = 0;
    setActive(false);
  };

  const onDragEnter = (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    dragDepth += 1;
    setActive(true);
  };

  const onDragOver = (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasFileDrag(e.dataTransfer) ? 'copy' : 'move';
  };

  const onDragLeave = (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && !section.contains(e.relatedTarget)) {
      setActive(false);
    }
  };

  const onDrop = async (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropState();

    const importTags = target.kind === 'tag' ? [target.tagId] : [];

    const paths = getDroppedPdfPaths(e.dataTransfer);
    if (paths.length) {
      await runFileImport(context, paths, importTags);
      return;
    }

    if (!hasInternalViewDrag(e.dataTransfer)) return;
    const viewId = e.dataTransfer.getData('text/plain');
    if (!viewId) return;

    if (target.kind === 'untagged') {
      await context.handlers.onSetTags(viewId, []);
    } else {
      await context.handlers.onAddTag(viewId, target.tagId);
    }
  };

  section.addEventListener('dragenter', onDragEnter);
  section.addEventListener('dragover', onDragOver);
  section.addEventListener('dragleave', onDragLeave);
  section.addEventListener('drop', onDrop);
  section.addEventListener('dragend', clearDropState);
}

function buildAddTagDropZone(context) {
  const section = el('section', 'library-section add-tag-section');
  section.appendChild(el('h2', 'section-title', 'Add tag'));

  const zone = el('button', 'add-tag-dropzone');
  zone.type = 'button';
  zone.textContent = 'Create a tag, or drop a view here to tag it';
  zone.setAttribute('aria-label', 'Create a new tag, or drop a view here to create and apply a tag');

  const createTagAndApply = async (viewId, paths) => {
    const def = await tagDialog({ title: 'New tag' });
    if (!def) return;
    const tag = await context.handlers.onCreateTag(def);
    if (!tag) return;
    if (paths && paths.length) {
      await runFileImport(context, paths, [tag.id]);
    } else if (viewId) {
      await context.handlers.onAddTag(viewId, tag.id);
    }
  };

  zone.addEventListener('click', () => createTagAndApply());

  let dragDepth = 0;
  const accepts = (dt) => hasInternalViewDrag(dt) || hasFileDrag(dt);
  const setActive = (active) => {
    section.classList.toggle('is-drop-target', active);
    zone.classList.toggle('is-drop-target', active);
  };
  const clearDropState = () => {
    dragDepth = 0;
    setActive(false);
  };

  const onDragEnter = (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    dragDepth += 1;
    setActive(true);
  };

  const onDragOver = (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && !section.contains(e.relatedTarget)) {
      setActive(false);
    }
  };

  const onDrop = async (e) => {
    if (libraryState.selectionMode) return;
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropState();

    // Capture drop payload synchronously; the DataTransfer is cleared once we
    // await the dialog below.
    const paths = getDroppedPdfPaths(e.dataTransfer);
    const internalViewId = hasInternalViewDrag(e.dataTransfer) ? e.dataTransfer.getData('text/plain') : '';
    await createTagAndApply(internalViewId, paths);
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
  const { handlers, config } = context;
  const current = new Set(view.tags);
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

  for (const tag of config.tags) {
    if (current.has(tag.id)) continue;
    items.push({ label: `Add “${tagDisplayName(tag)}”`, onClick: () => handlers.onAddTag(view.id, tag.id) });
  }
  items.push({
    label: 'New tag…',
    onClick: async () => {
      const def = await tagDialog({ title: 'New tag' });
      if (!def) return;
      const tag = await handlers.onCreateTag(def);
      if (tag) await handlers.onAddTag(view.id, tag.id);
    },
  });

  const applied = viewTags(view, context);
  if (applied.length) {
    items.push({ separator: true });
    for (const tag of applied) {
      items.push({ label: `Remove “${tagDisplayName(tag)}”`, onClick: () => handlers.onRemoveTag(view.id, tag.id) });
    }
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

function buildImportMenuItems(tags, handlers) {
  const onImport = (tagIds) => {
    prepareLibraryForImportedViews(tagIds);
    handlers.onCreate(tagIds);
  };

  const items = [{ label: 'Import as Untagged', onClick: () => onImport([]) }];

  if (tags.length) {
    items.push({ separator: true });
    for (const tag of tags) {
      items.push({ label: `Import with “${tagDisplayName(tag)}”`, onClick: () => onImport([tag.id]) });
    }
  }

  items.push({ separator: true });
  items.push({
    label: 'Import with New tag…',
    onClick: async () => {
      const def = await tagDialog({ title: 'New tag' });
      if (!def) return;
      const tag = await handlers.onCreateTag(def);
      if (tag) onImport([tag.id]);
    },
  });

  return items;
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
      context.handlers.onCreate([]);
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

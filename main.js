'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const {
  SECTION_SORTS,
  assertViewId,
  normaliseTag,
  normalisePdfPaths,
  sanitizeTagIds,
  sanitizeMetadataPatch,
} = require('./lib/metadata');

// Allow tests and screenshot tooling to point the app at a throwaway profile.
if (process.env.EASYVIEWERPDF_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.EASYVIEWERPDF_USER_DATA));
}

/**
 * The library lives in the per-user app data folder so that views (and their
 * copied source PDFs) are kept safe and separate from the user's originals.
 *   <userData>/library/<viewId>/source.pdf
 *   <userData>/library/<viewId>/view.json
 */
function libraryDir() {
  return path.join(app.getPath('userData'), 'library');
}

function configPath() {
  return path.join(libraryDir(), 'library.json');
}

const DEFAULT_CONFIG = { version: 1, sectionSort: 'manual', tags: [] };

async function ensureLibrary() {
  await fs.mkdir(libraryDir(), { recursive: true });
  await migrateLibrary();
}

async function readConfig() {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      sectionSort: SECTION_SORTS.includes(parsed?.sectionSort) ? parsed.sectionSort : 'manual',
      tags: Array.isArray(parsed?.tags) ? parsed.tags.map(normaliseTag).filter(Boolean) : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG, tags: [] };
  }
}

async function writeConfig(config) {
  // Re-pack `order` so it always reflects array position.
  const tags = config.tags.map((tag, index) => ({ ...tag, order: index }));
  const payload = { version: 1, sectionSort: config.sectionSort, tags };
  await fs.writeFile(configPath(), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

// One-time conversion of the legacy single-`category` model into the tag
// registry. Idempotent: it bails out as soon as a config file exists.
async function migrateLibrary() {
  try {
    await fs.access(configPath());
    return; // Already migrated.
  } catch {
    // No config yet — fall through and build one.
  }

  const entries = await fs.readdir(libraryDir(), { withFileTypes: true });
  const config = { version: 1, sectionSort: 'manual', tags: [] };
  const byName = new Map();

  const ensureTagByName = (name) => {
    const key = name.toLowerCase();
    if (byName.has(key)) return byName.get(key);
    const tag = { id: crypto.randomUUID(), name, color: '', order: config.tags.length };
    config.tags.push(tag);
    byName.set(key, tag);
    return tag;
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let meta;
    try {
      meta = await readView(entry.name);
    } catch {
      continue;
    }
    if (Array.isArray(meta.tags)) continue; // Already tag-shaped.

    const category = typeof meta.category === 'string' ? meta.category.trim() : '';
    meta.tags = category ? [ensureTagByName(category).id] : [];
    delete meta.category;
    await writeView(meta);
  }

  await writeConfig(config);
}

async function readView(id) {
  const file = path.join(libraryDir(), assertViewId(id), 'view.json');
  const meta = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!Array.isArray(meta.tags)) meta.tags = [];
  return meta;
}

async function writeView(meta) {
  const file = path.join(libraryDir(), meta.id, 'view.json');
  await fs.writeFile(file, JSON.stringify(meta, null, 2), 'utf8');
}

async function listViews() {
  await ensureLibrary();
  const entries = await fs.readdir(libraryDir(), { withFileTypes: true });
  const views = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      views.push(await readView(entry.name));
    } catch {
      // Skip folders without a valid view.json.
    }
  }
  views.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return views;
}

async function createViews(options = {}) {
  const tags = sanitizeTagIds(options?.tags);
  let filePaths = normalisePdfPaths(options?.filePaths);

  await ensureLibrary();

  if (filePaths.length === 0) {
    const result = await dialog.showOpenDialog({
      title: 'Choose PDF files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    filePaths = normalisePdfPaths(result.filePaths);
  }

  const created = [];
  for (const source of filePaths) {
    const id = crypto.randomUUID();
    const dir = path.join(libraryDir(), id);
    await fs.mkdir(dir, { recursive: true });

    // Copy (not move) so the view keeps working even if the user later deletes
    // or moves their original file, without destructively touching their copy.
    await fs.copyFile(source, path.join(dir, 'source.pdf'));

    const meta = {
      id,
      name: path.basename(source, path.extname(source)) || 'Untitled',
      createdAt: new Date().toISOString(),
      pdfFile: 'source.pdf',
      tags,
      layout: { cols: 2, rows: 1, groupScale: 1, overrides: {} },
    };

    await writeView(meta);
    created.push(meta);
  }

  return created;
}

async function getViewPdf(id) {
  return await fs.readFile(getViewPdfPath(id));
}

function getViewPdfPath(id) {
  return path.join(libraryDir(), assertViewId(id), 'source.pdf');
}

// --- Tag registry CRUD -----------------------------------------------------

async function createTag(def) {
  const name = typeof def?.name === 'string' ? def.name.trim() : '';
  const color = typeof def?.color === 'string' && def.color.trim() ? def.color.trim() : '';
  if (!name && !color) throw new Error('A tag needs a name or a color.');

  const config = await readConfig();
  const tag = { id: crypto.randomUUID(), name, color, order: config.tags.length };
  config.tags.push(tag);
  await writeConfig(config);
  return tag;
}

async function updateTag(id, def) {
  const config = await readConfig();
  const tag = config.tags.find((t) => t.id === id);
  if (!tag) throw new Error('Unknown tag.');

  const name = typeof def?.name === 'string' ? def.name.trim() : tag.name;
  const color =
    def?.color === '' ? '' : typeof def?.color === 'string' && def.color.trim() ? def.color.trim() : tag.color;
  if (!name && !color) throw new Error('A tag needs a name or a color.');

  tag.name = name;
  tag.color = color;
  await writeConfig(config);
  return tag;
}

async function deleteTag(id) {
  const config = await readConfig();
  config.tags = config.tags.filter((t) => t.id !== id);
  await writeConfig(config);

  // Strip the id from every view that referenced it.
  const views = await listViews();
  for (const view of views) {
    if (view.tags.includes(id)) {
      await updateView(view.id, { tags: view.tags.filter((t) => t !== id) });
    }
  }
  return true;
}

async function reorderTags(orderedIds) {
  const ids = sanitizeTagIds(orderedIds);
  const config = await readConfig();
  const byId = new Map(config.tags.map((t) => [t.id, t]));
  const ordered = [];
  for (const id of ids) {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  // Keep any tags not mentioned in the request at the end (defensive).
  for (const tag of byId.values()) ordered.push(tag);
  config.tags = ordered;
  return writeConfig(config);
}

async function setSectionSort(value) {
  const config = await readConfig();
  config.sectionSort = SECTION_SORTS.includes(value) ? value : 'manual';
  await writeConfig(config);
  return config.sectionSort;
}

async function exportMetadata() {
  const views = await listViews();
  const config = await readConfig();
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    sectionSort: config.sectionSort,
    tags: config.tags,
    views: views.map((v) => ({
      id: v.id,
      name: v.name,
      tags: v.tags,
      createdAt: v.createdAt,
      layout: v.layout,
    })),
  };

  const result = await dialog.showSaveDialog({
    title: 'Export library metadata',
    defaultPath: 'easyviewerpdf-library-metadata.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false, count: 0 };

  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { saved: true, count: payload.views.length, filePath: result.filePath };
}

async function importMetadata() {
  const result = await dialog.showOpenDialog({
    title: 'Import library metadata',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: 0, skipped: 0, filePath: null };
  }

  const filePath = result.filePaths[0];
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const incoming = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.views) ? parsed.views : [];
  if (!incoming.length) return { imported: 0, skipped: 0, filePath };

  const current = await listViews();
  const byId = new Map(current.map((v) => [v.id, v]));

  // Reconcile the incoming tag registry (and any legacy categories) against the
  // local one, building a map from incoming tag id -> local tag id. Missing
  // tags are created; named tags are matched case-insensitively.
  const config = await readConfig();
  const localByName = new Map(config.tags.filter((t) => t.name).map((t) => [t.name.toLowerCase(), t]));
  const localById = new Map(config.tags.map((t) => [t.id, t]));
  const tagIdMap = new Map();

  const ensureLocalTag = ({ id, name, color }) => {
    if (id && localById.has(id)) return localById.get(id).id;
    const trimmedName = (name || '').trim();
    if (trimmedName && localByName.has(trimmedName.toLowerCase())) {
      return localByName.get(trimmedName.toLowerCase()).id;
    }
    if (!trimmedName && !color) return '';
    const tag = { id: crypto.randomUUID(), name: trimmedName, color: color || '', order: config.tags.length };
    config.tags.push(tag);
    localById.set(tag.id, tag);
    if (trimmedName) localByName.set(trimmedName.toLowerCase(), tag);
    return tag.id;
  };

  for (const tag of Array.isArray(parsed?.tags) ? parsed.tags : []) {
    if (typeof tag?.id !== 'string') continue;
    tagIdMap.set(tag.id, ensureLocalTag(tag));
  }
  if (SECTION_SORTS.includes(parsed?.sectionSort)) config.sectionSort = parsed.sectionSort;
  await writeConfig(config);

  let imported = 0;
  let skipped = 0;

  for (const item of incoming) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || !byId.has(id)) {
      skipped += 1;
      continue;
    }

    // Resolve this view's tags: remap exported ids, plus convert any legacy
    // `category` string into a tag id.
    let resolvedTags = null;
    if (Array.isArray(item.tags)) {
      resolvedTags = item.tags.map((t) => tagIdMap.get(t) || (localById.has(t) ? t : '')).filter(Boolean);
    }
    const legacyCategory = typeof item.category === 'string' ? item.category.trim() : '';
    if (legacyCategory) {
      const tagId = ensureLocalTag({ name: legacyCategory });
      resolvedTags = [...(resolvedTags || byId.get(id).tags), tagId];
      await writeConfig(config);
    }

    const patch = sanitizeMetadataPatch({ ...item, tags: resolvedTags ?? undefined });
    if (!Object.keys(patch).length) {
      skipped += 1;
      continue;
    }
    await updateView(id, patch);
    imported += 1;
  }

  return { imported, skipped, filePath };
}

async function restoreView(snapshot) {
  const id = typeof snapshot?.id === 'string' ? snapshot.id : '';
  const pdfBase64 = typeof snapshot?.pdfBase64 === 'string' ? snapshot.pdfBase64 : '';
  if (!id || !pdfBase64 || !snapshot?.meta || snapshot.meta.id !== id) {
    throw new Error('Invalid restore snapshot.');
  }

  const dir = path.join(libraryDir(), assertViewId(id));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'source.pdf'), Buffer.from(pdfBase64, 'base64'));
  await writeView(snapshot.meta);
  return snapshot.meta;
}

async function updateView(id, patch) {
  const meta = await readView(id);
  const merged = {
    ...meta,
    ...patch,
    layout: { ...meta.layout, ...(patch && patch.layout) },
  };
  await writeView(merged);
  return merged;
}

async function deleteView(id) {
  await fs.rm(path.join(libraryDir(), assertViewId(id)), { recursive: true, force: true });
  return true;
}

function registerIpc() {
  ipcMain.handle('views:list', () => listViews());
  ipcMain.handle('views:create-many', (_e, options) => createViews(options));
  ipcMain.handle('library:config', () => readConfig());
  ipcMain.handle('tags:create', (_e, def) => createTag(def));
  ipcMain.handle('tags:update', (_e, id, def) => updateTag(id, def));
  ipcMain.handle('tags:delete', (_e, id) => deleteTag(id));
  ipcMain.handle('tags:reorder', (_e, ids) => reorderTags(ids));
  ipcMain.handle('library:set-section-sort', (_e, value) => setSectionSort(value));
  ipcMain.handle('views:get', (_e, id) => readView(id));
  ipcMain.handle('views:pdf', (_e, id) => getViewPdf(id));
  ipcMain.handle('views:reveal-pdf', (_e, id) => shell.showItemInFolder(getViewPdfPath(id)));
  ipcMain.handle('views:copy-pdf-path', (_e, id) => {
    const file = getViewPdfPath(id);
    clipboard.writeText(file);
    return file;
  });
  ipcMain.handle('views:restore', (_e, snapshot) => restoreView(snapshot));
  ipcMain.handle('views:update', (_e, id, patch) => updateView(id, patch));
  ipcMain.handle('views:delete', (_e, id) => deleteView(id));
  ipcMain.handle('app:reveal-library', () => shell.openPath(libraryDir()));
  ipcMain.handle('app:export-metadata', () => exportMetadata());
  ipcMain.handle('app:import-metadata', () => importMetadata());

  ipcMain.handle('window:toggle-fullscreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return next;
  });
  ipcMain.handle('window:is-fullscreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? win.isFullScreen() : false;
  });

  ipcMain.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle('window:is-maximized', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? win.isMaximized() : false;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#16181d',
    show: false,
    title: 'EasyViewerPDF',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  win.once('ready-to-show', () => win.show());
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen-changed', false));
  win.on('maximize', () => win.webContents.send('window:maximized-changed', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized-changed', false));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

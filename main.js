'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

/**
 * The library lives in the per-user app data folder so that views (and their
 * copied source PDFs) are kept safe and separate from the user's originals.
 *   <userData>/library/<viewId>/source.pdf
 *   <userData>/library/<viewId>/view.json
 */
function libraryDir() {
  return path.join(app.getPath('userData'), 'library');
}

async function ensureLibrary() {
  await fs.mkdir(libraryDir(), { recursive: true });
}

async function readView(id) {
  const file = path.join(libraryDir(), id, 'view.json');
  return JSON.parse(await fs.readFile(file, 'utf8'));
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

function normalisePdfPaths(paths) {
  if (!Array.isArray(paths)) return [];
  const unique = new Set();
  for (const item of paths) {
    if (typeof item !== 'string') continue;
    const full = path.resolve(item);
    if (path.extname(full).toLowerCase() !== '.pdf') continue;
    unique.add(full);
  }
  return [...unique];
}

async function createViews(options = {}) {
  const category = typeof options?.category === 'string' ? options.category.trim() : '';
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
      layout: { cols: 2, rows: 1, groupScale: 1, overrides: {} },
    };
    if (category) meta.category = category;

    await writeView(meta);
    created.push(meta);
  }

  return created;
}

async function createView() {
  const created = await createViews();
  return created[0] || null;
}

async function getViewPdf(id) {
  const file = path.join(libraryDir(), id, 'source.pdf');
  return await fs.readFile(file);
}

function getViewPdfPath(id) {
  return path.join(libraryDir(), id, 'source.pdf');
}

function sanitizeMetadataPatch(patch) {
  const next = {};
  if (typeof patch?.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  if (typeof patch?.category === 'string') next.category = patch.category.trim();
  if (patch?.layout && typeof patch.layout === 'object') next.layout = patch.layout;
  return next;
}

async function exportMetadata() {
  const views = await listViews();
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    views: views.map((v) => ({
      id: v.id,
      name: v.name,
      category: (v.category || '').trim(),
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
  let imported = 0;
  let skipped = 0;

  for (const item of incoming) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || !byId.has(id)) {
      skipped += 1;
      continue;
    }
    const patch = sanitizeMetadataPatch(item);
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

  const dir = path.join(libraryDir(), id);
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
  await fs.rm(path.join(libraryDir(), id), { recursive: true, force: true });
  return true;
}

function registerIpc() {
  ipcMain.handle('views:list', () => listViews());
  ipcMain.handle('views:create', () => createView());
  ipcMain.handle('views:create-many', (_e, options) => createViews(options));
  ipcMain.handle('views:get', (_e, id) => readView(id));
  ipcMain.handle('views:pdf', (_e, id) => getViewPdf(id));
  ipcMain.handle('views:pdf-path', (_e, id) => getViewPdfPath(id));
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

'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Minimal, explicit bridge between the renderer UI and the file-system backed
 * library in the main process. Everything is promise-based.
 */
contextBridge.exposeInMainWorld('api', {
  // Electron 32+ removed File.path; webUtils.getPathForFile is the supported
  // way to resolve the absolute path of a dropped/selected file.
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  listViews: () => ipcRenderer.invoke('views:list'),
  createViews: (options) => ipcRenderer.invoke('views:create-many', options),
  getView: (id) => ipcRenderer.invoke('views:get', id),
  getViewPdf: (id) => ipcRenderer.invoke('views:pdf', id),
  revealViewPdf: (id) => ipcRenderer.invoke('views:reveal-pdf', id),
  // Tag registry + library preferences.
  getLibraryConfig: () => ipcRenderer.invoke('library:config'),
  createTag: (def) => ipcRenderer.invoke('tags:create', def),
  updateTag: (id, def) => ipcRenderer.invoke('tags:update', id, def),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', id),
  reorderTags: (ids) => ipcRenderer.invoke('tags:reorder', ids),
  setSectionSort: (value) => ipcRenderer.invoke('library:set-section-sort', value),
  copyViewPdfPath: (id) => ipcRenderer.invoke('views:copy-pdf-path', id),
  restoreView: (snapshot) => ipcRenderer.invoke('views:restore', snapshot),
  updateView: (id, patch) => ipcRenderer.invoke('views:update', id, patch),
  deleteView: (id) => ipcRenderer.invoke('views:delete', id),
  revealLibrary: () => ipcRenderer.invoke('app:reveal-library'),
  exportMetadata: () => ipcRenderer.invoke('app:export-metadata'),
  importMetadata: () => ipcRenderer.invoke('app:import-metadata'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  onFullscreenChange: (callback) => {
    const listener = (_e, value) => callback(value);
    ipcRenderer.on('window:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizeChange: (callback) => {
    const listener = (_e, value) => callback(value);
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },
});

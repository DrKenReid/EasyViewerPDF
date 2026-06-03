'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal, explicit bridge between the renderer UI and the file-system backed
 * library in the main process. Everything is promise-based.
 */
contextBridge.exposeInMainWorld('api', {
  listViews: () => ipcRenderer.invoke('views:list'),
  createView: () => ipcRenderer.invoke('views:create'),
  createViews: (options) => ipcRenderer.invoke('views:create-many', options),
  getView: (id) => ipcRenderer.invoke('views:get', id),
  getViewPdf: (id) => ipcRenderer.invoke('views:pdf', id),
  getViewPdfPath: (id) => ipcRenderer.invoke('views:pdf-path', id),
  revealViewPdf: (id) => ipcRenderer.invoke('views:reveal-pdf', id),
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

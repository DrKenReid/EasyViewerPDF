// Thin wrapper around pdf.js for the bits this app needs: loading a document
// and rendering a single page to a canvas at a chosen pixel width.

import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';

// The worker is loaded as a module worker straight from node_modules.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

/**
 * Load a PDF document from raw bytes.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function loadPdf(bytes) {
  // Copy into a fresh Uint8Array: pdf.js may detach the underlying buffer.
  const data = new Uint8Array(bytes);
  return await pdfjsLib.getDocument({ data }).promise;
}

/**
 * Render a single page to a freshly created canvas.
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdf
 * @param {number} pageNumber 1-based page number.
 * @param {number} pixelWidth Target canvas width in device pixels.
 * @returns {Promise<{ canvas: HTMLCanvasElement, aspect: number }>} aspect = width / height.
 */
export async function renderPage(pdf, pageNumber, pixelWidth) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.1, pixelWidth / base.width);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  return { canvas, aspect: base.width / base.height };
}

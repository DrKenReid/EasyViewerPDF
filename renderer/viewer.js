// The viewer screen: splits a PDF into pages and lays them out in a fully
// malleable grid. Columns and rows are adjustable; page size is malleable per
// page (drag a page's corner) or for the whole group (Ctrl+drag, or the size
// controls). Pages are rendered lazily as they scroll into view.

import { el, clear, iconButton } from './dom.js';
import { loadPdf, renderPage } from './pdfutil.js';
import { isOverlayOpen, openContextMenu } from './ui.js';

const MIN_COLS = 1;
const MAX_COLS = 8;
const MIN_ROWS = 1;
const MAX_ROWS = 8;
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const GAP = 18; // must match --page-gap in styles.css

/**
 * @param {HTMLElement} root
 * @param {object} view View metadata (id, name, layout).
 * @param {Uint8Array} bytes Raw PDF bytes.
 * @param {{ onBack: Function, onChange: (patch: object) => void }} handlers
 */
export async function renderViewer(root, view, bytes, handlers) {
  clear(root);

  const layout = normaliseLayout(view.layout);
  let baseWidth = 200; // recomputed from the stage size
  let firstAspect = 0.7727; // US Letter portrait fallback (w/h); refined after load

  // ---- Scaffolding -------------------------------------------------------
  const screen = el('div', 'viewer');

  const toolbar = el('header', 'toolbar');
  const left = el('div', 'toolbar-group');
  const back = el('button', 'btn btn-ghost');
  back.type = 'button';
  back.textContent = '← Library';
  back.addEventListener('click', handlers.onBack);
  left.appendChild(back);
  const title = el('h1', 'toolbar-title', view.name);
  left.appendChild(title);
  toolbar.appendChild(left);

  title.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Copy PDF path', onClick: () => window.api.copyViewPdfPath(view.id) },
      { label: 'Reveal PDF in folder', onClick: () => window.api.revealViewPdf(view.id) },
    ]);
  });

  const controls = el('div', 'toolbar-group toolbar-controls');
  toolbar.appendChild(controls);
  screen.appendChild(toolbar);

  const stage = el('div', 'stage');
  stage.setAttribute('role', 'list');
  stage.setAttribute('aria-label', `Pages of ${view.name}`);
  const grid = el('div', 'page-grid');
  stage.appendChild(grid);
  screen.appendChild(stage);

  const status = el('div', 'status-bar');
  screen.appendChild(status);

  root.appendChild(screen);

  // ---- Load the document -------------------------------------------------
  let pdf;
  try {
    pdf = await loadPdf(bytes);
  } catch (err) {
    clear(grid);
    grid.appendChild(el('p', 'load-error', 'This PDF could not be opened.'));
    return;
  }
  const pageCount = pdf.numPages;

  try {
    const first = await pdf.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    firstAspect = vp.width / vp.height;
  } catch {
    /* keep fallback aspect */
  }

  // ---- Persistence (debounced) ------------------------------------------
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => handlers.onChange({ layout }), 300);
  }

  // ---- Size maths --------------------------------------------------------
  function recomputeBaseWidth() {
    const stageW = stage.clientWidth - 32; // horizontal padding
    const stageH = stage.clientHeight - 32; // vertical padding
    const widthFit = (stageW - GAP * (layout.cols - 1)) / layout.cols;
    const heightFit = ((stageH - GAP * (layout.rows - 1)) / layout.rows) * firstAspect;
    baseWidth = Math.max(60, Math.min(widthFit, heightFit));
  }

  function widthForPage(index) {
    const multiplier = layout.overrides[index] != null ? layout.overrides[index] : layout.groupScale;
    return Math.max(40, baseWidth * multiplier);
  }

  // ---- Page tiles --------------------------------------------------------
  const tiles = []; // { wrapper, frame, canvasHost, pageNumber, rendered, aspect }

  function buildTiles() {
    clear(grid);
    tiles.length = 0;
    grid.style.gridTemplateColumns = `repeat(${layout.cols}, auto)`;

    for (let i = 0; i < pageCount; i++) {
      const wrapper = el('div', 'page');
      wrapper.setAttribute('role', 'listitem');

      const frame = el('div', 'page-frame');
      const canvasHost = el('div', 'page-canvas-host');
      const spinner = el('div', 'page-loading', String(i + 1));
      canvasHost.appendChild(spinner);
      frame.appendChild(canvasHost);

      const handle = el('button', 'resize-handle');
      handle.type = 'button';
      handle.tabIndex = -1;
      handle.setAttribute('aria-hidden', 'true');
      handle.title = 'Drag to resize this page · Hold Ctrl to resize all pages';
      frame.appendChild(handle);
      attachResize(handle, i);

      wrapper.appendChild(frame);
      wrapper.appendChild(el('div', 'page-number', `Page ${i + 1}`));
      grid.appendChild(wrapper);

      const tile = { wrapper, frame, canvasHost, pageNumber: i + 1, rendered: false, aspect: firstAspect };
      tiles.push(tile);
      observer.observe(frame);
    }
    applySizes();
  }

  function applySizes() {
    for (let i = 0; i < tiles.length; i++) {
      const w = widthForPage(i);
      const tile = tiles[i];
      tile.frame.style.width = `${w}px`;
      tile.frame.style.height = `${w / tile.aspect}px`;
    }
  }

  // ---- Lazy rendering ----------------------------------------------------
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const tile = tiles.find((t) => t.frame === entry.target);
          if (tile) renderTile(tile);
        }
      }
    },
    { root: stage, rootMargin: '400px' }
  );

  async function renderTile(tile) {
    if (tile.rendered) return;
    tile.rendered = true;
    try {
      const pixelWidth = Math.min(1600, Math.max(480, widthForPage(tile.pageNumber - 1) * window.devicePixelRatio));
      const { canvas, aspect } = await renderPage(pdf, tile.pageNumber, pixelWidth);
      tile.aspect = aspect;
      canvas.className = 'page-canvas';
      clear(tile.canvasHost);
      tile.canvasHost.appendChild(canvas);
      // Refresh this tile's height now that we know its true aspect ratio.
      const w = widthForPage(tile.pageNumber - 1);
      tile.frame.style.height = `${w / tile.aspect}px`;
    } catch {
      tile.rendered = false;
      const placeholder = tile.canvasHost.firstChild;
      if (placeholder) placeholder.textContent = '!';
    }
  }

  // ---- Resizing (drag a page corner) ------------------------------------
  function attachResize(handle, index) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = widthForPage(index);
      const groupMode = e.ctrlKey || e.metaKey;
      grid.classList.add('resizing');

      const onMove = (move) => {
        const newWidth = clamp(startWidth + (move.clientX - startX), baseWidth * MIN_SCALE, baseWidth * MAX_SCALE);
        const multiplier = clamp(newWidth / baseWidth, MIN_SCALE, MAX_SCALE);
        if (groupMode) {
          // "Resize all pages": uniform group scale, clear per-page overrides.
          layout.groupScale = multiplier;
          layout.overrides = {};
        } else {
          layout.overrides[index] = multiplier;
        }
        applySizes();
      };
      const onUp = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        grid.classList.remove('resizing');
        persist();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  // ---- Toolbar controls --------------------------------------------------
  const colsControl = makeStepper('Columns', () => layout.cols, (v) => setCols(v), MIN_COLS, MAX_COLS);
  const rowsControl = makeStepper('Rows on screen', () => layout.rows, (v) => setRows(v), MIN_ROWS, MAX_ROWS);
  const sizeControl = makeSizeControl();
  controls.appendChild(colsControl.element);
  controls.appendChild(rowsControl.element);
  controls.appendChild(sizeControl.element);

  function setCols(value) {
    layout.cols = clamp(value, MIN_COLS, MAX_COLS);
    colsControl.refresh();
    grid.style.gridTemplateColumns = `repeat(${layout.cols}, auto)`;
    recomputeBaseWidth();
    applySizes();
    persist();
  }
  function setRows(value) {
    layout.rows = clamp(value, MIN_ROWS, MAX_ROWS);
    rowsControl.refresh();
    recomputeBaseWidth();
    applySizes();
    persist();
  }
  function setGroupScale(value) {
    layout.groupScale = clamp(value, MIN_SCALE, MAX_SCALE);
    layout.overrides = {};
    sizeControl.refresh();
    applySizes();
    persist();
  }

  function makeSizeControl() {
    const wrap = el('div', 'control');
    wrap.appendChild(labelFor('size-range', 'Size'));
    const minus = stepBtn('Smaller', '−', () => setGroupScale(round(layout.groupScale - 0.1)));
    const range = el('input', 'control-range');
    range.type = 'range';
    range.id = 'size-range';
    range.min = String(MIN_SCALE);
    range.max = String(MAX_SCALE);
    range.step = '0.05';
    range.setAttribute('aria-label', 'Size of all pages');
    range.addEventListener('input', () => setGroupScale(parseFloat(range.value)));
    const plus = stepBtn('Bigger', '+', () => setGroupScale(round(layout.groupScale + 0.1)));
    wrap.append(minus, range, plus);
    return {
      element: wrap,
      refresh() {
        range.value = String(layout.groupScale);
      },
    };
  }

  // ---- Keyboard shortcuts ------------------------------------------------
  function onKeydown(e) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      if (isOverlayOpen()) return; // let the open dialog/menu handle it
      e.preventDefault();
      handlers.onBack();
    } else if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      setGroupScale(round(layout.groupScale + 0.1));
    } else if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      setGroupScale(round(layout.groupScale - 0.1));
    } else if (e.key === ']') {
      setCols(layout.cols + 1);
    } else if (e.key === '[') {
      setCols(layout.cols - 1);
    }
  }
  document.addEventListener('keydown', onKeydown);

  // ---- Ctrl + mouse wheel changes the number of columns ------------------
  function onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.deltaY > 0) setCols(layout.cols + 1); // scroll down -> more columns (smaller pages)
    else if (e.deltaY < 0) setCols(layout.cols - 1);
  }
  stage.addEventListener('wheel', onWheel, { passive: false });

  // ---- Responsive --------------------------------------------------------
  let resizeRaf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      recomputeBaseWidth();
      applySizes();
    });
  });
  ro.observe(stage);

  // Clean up when navigating away (root is cleared on next render).
  const cleanup = new MutationObserver(() => {
    if (!root.contains(screen)) {
      document.removeEventListener('keydown', onKeydown);
      stage.removeEventListener('wheel', onWheel);
      ro.disconnect();
      observer.disconnect();
      cleanup.disconnect();
      pdf.destroy && pdf.destroy();
    }
  });
  cleanup.observe(root, { childList: true });

  // ---- Go -----------------------------------------------------------------
  status.textContent = `${pageCount} page${pageCount === 1 ? '' : 's'}`;
  sizeControl.refresh();
  recomputeBaseWidth();
  buildTiles();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseLayout(layout) {
  const l = layout || {};
  return {
    cols: clamp(l.cols || 2, MIN_COLS, MAX_COLS),
    rows: clamp(l.rows || 1, MIN_ROWS, MAX_ROWS),
    groupScale: clamp(l.groupScale || 1, MIN_SCALE, MAX_SCALE),
    overrides: { ...(l.overrides || {}) },
  };
}

function makeStepper(label, getValue, setValue, min, max) {
  const wrap = el('div', 'control');
  wrap.appendChild(el('span', 'control-label', label));
  const minus = stepBtn(`Fewer ${label.toLowerCase()}`, '−', () => setValue(getValue() - 1));
  const value = el('span', 'control-value', String(getValue()));
  value.setAttribute('aria-live', 'polite');
  const plus = stepBtn(`More ${label.toLowerCase()}`, '+', () => setValue(getValue() + 1));
  minus.disabled = getValue() <= min;
  plus.disabled = getValue() >= max;
  wrap.append(minus, value, plus);
  return {
    element: wrap,
    refresh() {
      value.textContent = String(getValue());
      minus.disabled = getValue() <= min;
      plus.disabled = getValue() >= max;
    },
  };
}

function stepBtn(label, glyph, onClick) {
  const btn = el('button', 'step-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.textContent = glyph;
  btn.addEventListener('click', onClick);
  return btn;
}

function labelFor(id, text) {
  const label = el('label', 'control-label', text);
  label.setAttribute('for', id);
  return label;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

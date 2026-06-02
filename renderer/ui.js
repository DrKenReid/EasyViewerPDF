// Accessible modal dialogs. Electron's renderer does not implement
// window.prompt(), so we provide promise-based confirm/prompt replacements
// that are keyboard-friendly and theme-aware.

import { el, clear } from './dom.js';

let activeOverlay = null;

function openModal({ title, body, actions, initialFocus }) {
  closeModal();

  const overlay = el('div', 'modal-overlay');
  const dialog = el('div', 'modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const heading = el('h2', 'modal-title', title);
  const headingId = 'modal-title';
  heading.id = headingId;
  dialog.setAttribute('aria-labelledby', headingId);
  dialog.appendChild(heading);

  if (body) dialog.appendChild(body);

  const footer = el('div', 'modal-actions');
  for (const action of actions) footer.appendChild(action);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  const previousFocus = document.activeElement;
  (initialFocus || footer.querySelector('button')).focus();

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      overlay.dispatchEvent(new CustomEvent('dismiss'));
    } else if (e.key === 'Tab') {
      trapFocus(e, dialog);
    }
  }
  overlay.addEventListener('keydown', onKeydown);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) overlay.dispatchEvent(new CustomEvent('dismiss'));
  });
  overlay._restoreFocus = previousFocus;
  return overlay;
}

function closeModal() {
  if (!activeOverlay) return;
  const restore = activeOverlay._restoreFocus;
  activeOverlay.remove();
  activeOverlay = null;
  if (restore && typeof restore.focus === 'function') restore.focus();
}

function trapFocus(e, container) {
  const focusable = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Ask the user to confirm a (potentially destructive) action.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const body = el('p', 'modal-message', message);
    const cancel = el('button', 'btn');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = el('button', 'btn ' + (danger ? 'btn-danger' : 'btn-primary'));
    ok.type = 'button';
    ok.textContent = confirmLabel;

    const overlay = openModal({ title, body, actions: [cancel, ok], initialFocus: ok });
    const finish = (value) => {
      closeModal();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    overlay.addEventListener('dismiss', () => finish(false));
  });
}

/**
 * Prompt the user for a single line of text.
 * @returns {Promise<string|null>} trimmed value, or null if cancelled/empty.
 */
export function promptDialog({ title, message, value = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const body = el('div');
    if (message) body.appendChild(el('p', 'modal-message', message));
    const input = el('input', 'modal-input');
    input.type = 'text';
    input.value = value;
    input.setAttribute('aria-label', message || title);
    body.appendChild(input);

    const cancel = el('button', 'btn');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = el('button', 'btn btn-primary');
    ok.type = 'button';
    ok.textContent = confirmLabel;

    const overlay = openModal({ title, body, actions: [cancel, ok], initialFocus: input });
    input.select();

    const finish = (val) => {
      closeModal();
      resolve(val);
    };
    const submit = () => {
      const trimmed = input.value.trim();
      finish(trimmed ? trimmed : null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    cancel.addEventListener('click', () => finish(null));
    ok.addEventListener('click', submit);
    overlay.addEventListener('dismiss', () => finish(null));
  });
}

let activeMenu = null;

/**
 * Open a lightweight context menu at the given screen coordinates.
 * @param {number} x
 * @param {number} y
 * @param {Array<{label?: string, separator?: boolean, danger?: boolean, onClick?: Function}>} items
 */
export function openContextMenu(x, y, items) {
  closeContextMenu();

  const menu = el('div', 'context-menu');
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.separator) {
      menu.appendChild(el('div', 'context-separator'));
      continue;
    }
    const btn = el('button', 'context-item' + (item.danger ? ' context-item-danger' : ''));
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeContextMenu();
      item.onClick && item.onClick();
    });
    menu.appendChild(btn);
  }

  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  // Keep the menu inside the viewport.
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, px)}px`;
  menu.style.top = `${Math.max(8, py)}px`;
  menu.style.visibility = 'visible';
  activeMenu = menu;

  const dismiss = () => closeContextMenu();
  setTimeout(() => {
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('blur', dismiss);
  }, 0);

  function onPointerDown(e) {
    if (!menu.contains(e.target)) closeContextMenu();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
    }
  }
  menu._teardown = () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('blur', dismiss);
  };

  (menu.querySelector('.context-item') || menu).focus?.();
}

export function closeContextMenu() {
  if (!activeMenu) return;
  activeMenu._teardown && activeMenu._teardown();
  activeMenu.remove();
  activeMenu = null;
}

/** True while a modal or context menu is open. */
export function isOverlayOpen() {
  return Boolean(activeOverlay || activeMenu);
}

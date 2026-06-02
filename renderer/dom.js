// Tiny DOM helpers to keep the rest of the UI code declarative and readable.

/**
 * Create an element with optional class names and text content.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Remove all children from a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Create a labelled icon button.
 * @param {string} label Accessible label.
 * @param {string} glyph Visible glyph (decorative).
 * @param {() => void} onClick
 * @param {string} [extraClass]
 */
export function iconButton(label, glyph, onClick, extraClass) {
  const btn = el('button', 'icon-btn' + (extraClass ? ' ' + extraClass : ''));
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  const span = el('span', 'icon', glyph);
  span.setAttribute('aria-hidden', 'true');
  btn.appendChild(span);
  btn.addEventListener('click', onClick);
  return btn;
}

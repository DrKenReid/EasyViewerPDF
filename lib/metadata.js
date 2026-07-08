'use strict';

// Pure helpers for validating and normalising library metadata. Kept free of
// Electron imports so they can be unit-tested with `node --test`.

const path = require('path');

const SECTION_SORTS = ['manual', 'recent', 'alpha'];

// Library folders are always created with crypto.randomUUID(); anything else
// is rejected so renderer-supplied ids can never traverse outside the library.
const VIEW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isViewId(id) {
  return typeof id === 'string' && VIEW_ID_PATTERN.test(id);
}

function assertViewId(id) {
  if (!isViewId(id)) throw new Error('Invalid view id.');
  return id;
}

function normaliseTag(tag) {
  const id = typeof tag?.id === 'string' && tag.id ? tag.id : '';
  if (!id) return null;
  const name = typeof tag?.name === 'string' ? tag.name.trim() : '';
  const color = typeof tag?.color === 'string' && tag.color.trim() ? tag.color.trim() : '';
  if (!name && !color) return null;
  return { id, name, color, order: Number.isFinite(tag?.order) ? tag.order : 0 };
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

function sanitizeTagIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function sanitizeMetadataPatch(patch) {
  const next = {};
  if (typeof patch?.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  if (Array.isArray(patch?.tags)) next.tags = sanitizeTagIds(patch.tags);
  if (typeof patch?.lastOpenedAt === 'string') next.lastOpenedAt = patch.lastOpenedAt;
  if (patch?.layout && typeof patch.layout === 'object') next.layout = patch.layout;
  return next;
}

module.exports = {
  SECTION_SORTS,
  isViewId,
  assertViewId,
  normaliseTag,
  normalisePdfPaths,
  sanitizeTagIds,
  sanitizeMetadataPatch,
};

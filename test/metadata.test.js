'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  SECTION_SORTS,
  isViewId,
  assertViewId,
  normaliseTag,
  normalisePdfPaths,
  sanitizeTagIds,
  sanitizeMetadataPatch,
} = require('../lib/metadata');

const UUID = '123e4567-e89b-12d3-a456-426614174000';

test('isViewId accepts UUIDs and rejects anything path-like', () => {
  assert.equal(isViewId(UUID), true);
  assert.equal(isViewId(UUID.toUpperCase()), true);

  assert.equal(isViewId(''), false);
  assert.equal(isViewId(null), false);
  assert.equal(isViewId(42), false);
  assert.equal(isViewId('..'), false);
  assert.equal(isViewId('../evil'), false);
  assert.equal(isViewId('..\\evil'), false);
  assert.equal(isViewId(`${UUID}/../..`), false);
  assert.equal(isViewId('C:\\Windows'), false);
});

test('assertViewId returns the id or throws', () => {
  assert.equal(assertViewId(UUID), UUID);
  assert.throws(() => assertViewId('..'), /Invalid view id/);
  assert.throws(() => assertViewId(undefined), /Invalid view id/);
});

test('normaliseTag keeps well-formed tags and trims fields', () => {
  assert.deepEqual(normaliseTag({ id: 't1', name: '  Work  ', color: ' #fff ', order: 3 }), {
    id: 't1',
    name: 'Work',
    color: '#fff',
    order: 3,
  });
});

test('normaliseTag rejects tags without an id or without name and color', () => {
  assert.equal(normaliseTag(null), null);
  assert.equal(normaliseTag({ name: 'Work' }), null);
  assert.equal(normaliseTag({ id: 't1', name: '  ', color: '' }), null);
});

test('normaliseTag defaults a missing order to 0', () => {
  assert.equal(normaliseTag({ id: 't1', name: 'Work' }).order, 0);
  assert.equal(normaliseTag({ id: 't1', name: 'Work', order: 'x' }).order, 0);
});

test('normalisePdfPaths keeps only .pdf paths, resolved and deduped', () => {
  const a = path.resolve('a.pdf');
  const result = normalisePdfPaths(['a.pdf', 'a.pdf', 'b.txt', 42, null, 'c.PDF']);
  assert.deepEqual(result, [a, path.resolve('c.PDF')]);
});

test('normalisePdfPaths handles non-array input', () => {
  assert.deepEqual(normalisePdfPaths(undefined), []);
  assert.deepEqual(normalisePdfPaths('a.pdf'), []);
});

test('sanitizeTagIds dedupes and drops non-string entries', () => {
  assert.deepEqual(sanitizeTagIds(['a', 'b', 'a', '', 7, null]), ['a', 'b']);
  assert.deepEqual(sanitizeTagIds('not-an-array'), []);
});

test('sanitizeMetadataPatch keeps only known, well-typed fields', () => {
  const patch = sanitizeMetadataPatch({
    name: '  My view ',
    tags: ['t1', 't1', 9],
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    layout: { cols: 3 },
    id: 'should-be-dropped',
    pdfFile: 'should-be-dropped.pdf',
  });
  assert.deepEqual(patch, {
    name: 'My view',
    tags: ['t1'],
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    layout: { cols: 3 },
  });
});

test('sanitizeMetadataPatch drops empty names and wrong types', () => {
  assert.deepEqual(sanitizeMetadataPatch({ name: '   ', lastOpenedAt: 12, layout: 'x' }), {});
  assert.deepEqual(sanitizeMetadataPatch(null), {});
});

test('SECTION_SORTS covers the three supported modes', () => {
  assert.deepEqual(SECTION_SORTS, ['manual', 'recent', 'alpha']);
});

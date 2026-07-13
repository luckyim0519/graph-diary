'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseFrontmatter, parseTable, parseCSV } = require('../parse');

test('frontmatter: numbers, inline lists, empty values', () => {
  const { meta, body, present } = parseFrontmatter(
    '---\ntype: journal\nmood: 4\nsleep_hours: 6.5\ntags: [journal, life]\nempty:\n---\nBody here');
  assert.equal(present, true);
  assert.equal(meta.type, 'journal');
  assert.equal(meta.mood, 4);
  assert.equal(meta.sleep_hours, 6.5);
  assert.deepEqual(meta.tags, ['journal', 'life']);
  assert.equal(meta.empty, null);
  assert.equal(body, 'Body here');
});

test('table: header normalization and empty-row skipping', () => {
  const t = parseTable([
    '# Log', '',
    '| Date | Type | Duration (min) | Feel (1–5) |',
    '|------|------|----------------|------------|',
    '| 2026-07-06 | Run | 30 | 4 |',
    '|      |      |    |   |',
  ].join('\n'));
  assert.equal(t.rows.length, 1);
  assert.deepEqual(t.rows[0],
    { date: '2026-07-06', type: 'Run', duration: '30', feel: '4' });
});

test('table: missing table returns null', () => {
  assert.equal(parseTable('no table here'), null);
});

test('csv: quoted fields with commas and escaped quotes', () => {
  const rows = parseCSV('a,b\n"x, y","say ""hi"""\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

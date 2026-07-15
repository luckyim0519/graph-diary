'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { logHabit, habitRange } = require('../habitlog');
const { computePeriodStats } = require('../stats');
const { parseMiniYaml } = require('../config');
const { buildVault, cfgFor } = require('./fixtures');

test('logHabit appends a row the stats engine can read', () => {
  const cfg = cfgFor(buildVault());
  logHabit(cfg, 'exercise', {
    date: '2026-07-12', type: 'Pilates', detail: 'reformer',
    minutes: 50, intensity: 3, feel: 5, notes: '',
  });
  const e = computePeriodStats('week', '2026-W28', cfg).exercise;
  assert.equal(e.sessions, 4); // fixture had 3 in-week rows
  assert.equal(e.totalMin, 230); // 180 + 50
  assert.equal(e.typeDist.Pilates, 1);
});

test('logHabit creates the week file from template when absent', () => {
  const cfg = cfgFor(buildVault());
  const r = logHabit(cfg, 'study', {
    date: '2026-07-14', area: 'ML', what: 'rlhf paper', minutes: 45, depth: 4, output: false,
  });
  assert.equal(r.week, '2026-W29');
  const { byDay } = habitRange(cfg, 'study', '2026-07-13', '2026-07-19');
  assert.equal(byDay['2026-07-14'][0].minutes, 45);
  assert.equal(byDay['2026-07-14'][0].output, false);
});

test('habitRange aggregates days and collects study areas', () => {
  const cfg = cfgFor(buildVault());
  const { byDay, areas } = habitRange(cfg, 'study', '2026-07-06', '2026-07-12');
  assert.equal(byDay['2026-07-07'][0].minutes, 120);
  assert.ok(areas.includes('ML') && areas.includes('Korean'));
});

test('pipe characters in free text cannot break the table', () => {
  const cfg = cfgFor(buildVault());
  logHabit(cfg, 'exercise', {
    date: '2026-07-12', type: 'Gym', detail: 'legs | heavy', minutes: 40, intensity: 4, feel: 4,
  });
  const { byDay } = habitRange(cfg, 'exercise', '2026-07-12', '2026-07-12');
  const row = byDay['2026-07-12'].find((r) => r.type === 'Gym');
  assert.equal(row.minutes, 40);
  assert.equal(row.detail, 'legs / heavy');
});

test('config mini-yaml parses inline lists', () => {
  const cfg = parseMiniYaml('exercise_types: [Pilates, Gym, Band Stretching]\nmodel: x');
  assert.deepEqual(cfg.exercise_types, ['Pilates', 'Gym', 'Band Stretching']);
});

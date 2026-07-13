'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { computePeriodStats } = require('../stats');
const { buildVault, cfgFor } = require('./fixtures');

// Hand-computed expectations for the seeded week 2026-W28 — the acceptance
// criterion is that every number matches these exactly.

test('week 2026-W28: finance (transfer exclusion, recurring split, signs, FX)', () => {
  const cfg = cfgFor(buildVault());
  const f = computePeriodStats('week', '2026-W28', cfg).finance;
  assert.equal(f.txCount, 7);              // 8 July rows minus rent (Jul 1, outside week)
  assert.equal(f.incomeCAD, 4000);
  assert.equal(f.fixedCAD, 20.25);         // Netflix 15 USD × 1.35
  assert.equal(f.discretionaryCAD, 255.5); // 120.50 + 85 + 50000 KRW × 0.001
  assert.equal(f.spendingCAD, 275.75);
  assert.equal(f.investCAD, 1000);         // invest excluded from spending
  assert.equal(f.savingsRatePct, 93.1);    // (4000 − 275.75) / 4000
  // transfer must appear nowhere
  assert.equal(f.perCategoryCAD.Other, undefined);
  assert.deepEqual(f.perCategoryCAD, { Food: 205.5, Subscriptions: 20.25, Family: 50 });
  assert.deepEqual(f.top5Discretionary,
    [{ category: 'Food', cad: 205.5 }, { category: 'Family', cad: 50 }]);
  assert.equal(f.unplannedOver100.length, 1);
  assert.equal(f.unplannedOver100[0].description, 'Superstore run');
  assert.deepEqual(f.fxUsed, { CAD: 1, USD: 1.35, KRW: 0.001 });
});

test('week 2026-W28: exercise (row outside period excluded)', () => {
  const cfg = cfgFor(buildVault());
  const e = computePeriodStats('week', '2026-W28', cfg).exercise;
  assert.equal(e.missing, false);
  assert.equal(e.sessions, 3); // the 2026-07-13 row is next week
  assert.equal(e.target, 4);
  assert.equal(e.totalMin, 180);
  assert.equal(e.avgIntensity, 3.7); // (4+3+4)/3
  assert.equal(e.avgFeel, 4);        // (4+5+3)/3
  assert.deepEqual(e.typeDist, { Strength: 1, Run: 1, Cycling: 1 });
});

test('week 2026-W28: study', () => {
  const cfg = cfgFor(buildVault());
  const s = computePeriodStats('week', '2026-W28', cfg).study;
  assert.equal(s.hours, 4.5);        // 270 min
  assert.equal(s.targetHours, 5);
  assert.equal(s.avgDepth, 4);       // (4+3+5)/3
  assert.equal(s.outputRatio, 0.67); // 2 of 3
  assert.deepEqual(s.perAreaMin, { ML: 210, Korean: 60 });
  assert.deepEqual(s.focusAreas, ['ML', 'Korean']);
});

test('week 2026-W28: journal (incomplete entry excluded from averages, named)', () => {
  const cfg = cfgFor(buildVault());
  const j = computePeriodStats('week', '2026-W28', cfg).journal;
  assert.equal(j.entryCount, 5);
  assert.equal(j.avgMood, 3.5);   // (4+3+5+2)/4 — 07-09 excluded
  assert.equal(j.avgEnergy, 3);
  assert.equal(j.avgSleep, 6.6);  // 26.5/4 = 6.625
  assert.deepEqual(j.missingDates, ['2026-07-11', '2026-07-12']);
  assert.deepEqual(j.incompleteFrontmatter, ['2026-07-09']);
});

test('missing exercise log is flagged, never zero-filled', () => {
  const cfg = cfgFor(buildVault({ exerciseLog: false }));
  const e = computePeriodStats('week', '2026-W28', cfg).exercise;
  assert.equal(e.missing, true);
  assert.deepEqual(e.missingFiles, ['exercise-2026-W28.md']);
  assert.equal(e.sessions, undefined); // no fake zeros
});

test('previous period with no data at all → previous: null', () => {
  const cfg = cfgFor(buildVault());
  const stats = computePeriodStats('week', '2026-W28', cfg);
  assert.equal(stats.previous, null); // fixture has no W27 data
});

test('month 2026-07 includes the July-1 rent (fixed) and week rows', () => {
  const cfg = cfgFor(buildVault());
  const f = computePeriodStats('month', '2026-07', cfg).finance;
  assert.equal(f.txCount, 8);
  assert.equal(f.fixedCAD, 1820.25); // rent 1800 + Netflix 20.25
  assert.equal(f.discretionaryCAD, 255.5);
  assert.equal(f.savingsRatePct, 48.1); // (4000 − 2075.75) / 4000
});

test('stats object is JSON-serializable', () => {
  const cfg = cfgFor(buildVault());
  const stats = computePeriodStats('week', '2026-W28', cfg);
  assert.equal(typeof JSON.parse(JSON.stringify(stats)), 'object');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const iw = require('../isoweek');

test('Thursday rule at year boundaries', () => {
  // 2026-01-01 is a Thursday → year starts in W01
  assert.equal(iw.weekString('2026-01-01'), '2026-W01');
  // …and the Monday of that week is in 2025
  assert.equal(iw.weekString('2025-12-29'), '2026-W01');
  // 2026 starts on Thursday → 53 ISO weeks
  assert.equal(iw.weeksInYear(2026), 53);
  assert.equal(iw.weekString('2026-12-28'), '2026-W53');
  // Sunday 2027-01-03 still belongs to 2026-W53
  assert.equal(iw.weekString('2027-01-03'), '2026-W53');
  assert.equal(iw.weekString('2027-01-04'), '2027-W01');
  // a 52-week year
  assert.equal(iw.weeksInYear(2025), 52);
  // 2025-01-01 is a Wednesday → W01
  assert.equal(iw.weekString('2025-01-01'), '2025-W01');
  // 2021-01-01 is a Friday → belongs to 2020-W53
  assert.equal(iw.weekString('2021-01-01'), '2020-W53');
});

test('weekDates spans Mon..Sun', () => {
  const d = iw.weekDates('2026-W28');
  assert.equal(d.length, 7);
  assert.equal(d[0], '2026-07-06');
  assert.equal(d[6], '2026-07-12');
});

test('week spanning two months', () => {
  // 2026-W27: Jun 29 – Jul 5
  const d = iw.weekDates('2026-W27');
  assert.equal(d[0], '2026-06-29');
  assert.equal(d[6], '2026-07-05');
  assert.deepEqual([...new Set(d.map((x) => x.slice(0, 7)))], ['2026-06', '2026-07']);
});

test('prevWeek across the year boundary', () => {
  assert.equal(iw.prevWeek('2026-W02'), '2026-W01');
  assert.equal(iw.prevWeek('2026-W01'), '2025-W52');
  assert.equal(iw.prevWeek('2027-W01'), '2026-W53');
});

test('months', () => {
  assert.equal(iw.monthDates('2026-07').length, 31);
  assert.equal(iw.monthDates('2026-02').length, 28);
  assert.equal(iw.monthDates('2028-02').length, 29);
  assert.equal(iw.prevMonth('2026-01'), '2025-12');
  assert.equal(iw.prevMonth('2026-07'), '2026-06');
});

test('rejects invalid input', () => {
  assert.throws(() => iw.weekDates('2025-W53')); // 2025 has 52 weeks
  assert.throws(() => iw.weekString('2026-02-30'));
  assert.throws(() => iw.monthDates('2026-13'));
});

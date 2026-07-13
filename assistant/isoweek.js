// ISO-8601 week math, vendored (zero-dep by project rule; see docs/PRD §9.3).
// The Thursday rule: a date's ISO year/week is that of the Thursday of its week.
// Covered by test/isoweek.test.js including W52/W53/W01 year boundaries.
'use strict';

// Monday=1 … Sunday=7
function isoDow(d) {
  return ((d.getUTCDay() + 6) % 7) + 1;
}

function toUTC(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error(`bad date: ${dateStr}`);
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw new Error(`bad date: ${dateStr}`);
  // reject e.g. 2026-02-30 which Date silently rolls over
  if (d.toISOString().slice(0, 10) !== dateStr) throw new Error(`bad date: ${dateStr}`);
  return d;
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

// { year, week } for a YYYY-MM-DD string
function isoWeekOf(dateStr) {
  const d = toUTC(dateStr);
  const th = new Date(d);
  th.setUTCDate(d.getUTCDate() + 4 - isoDow(d));
  const year = th.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor((th - jan1) / 86400000 / 7) + 1;
  return { year, week };
}

// "YYYY-Www" for a YYYY-MM-DD string
function weekString(dateStr) {
  const { year, week } = isoWeekOf(dateStr);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// 52 or 53 (Dec 28 is always in the last ISO week of its year)
function weeksInYear(year) {
  return isoWeekOf(`${year}-12-28`).week;
}

function parseWeek(weekStr) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekStr);
  if (!m) throw new Error(`bad ISO week: ${weekStr} (expected YYYY-Www)`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > weeksInYear(year)) {
    throw new Error(`bad ISO week: ${weekStr} (${year} has ${weeksInYear(year)} weeks)`);
  }
  return { year, week };
}

// Date of the Monday of "YYYY-Www"
function mondayOf(weekStr) {
  const { year, week } = parseWeek(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4)); // Jan 4 is always in W01
  const mon1 = new Date(jan4);
  mon1.setUTCDate(jan4.getUTCDate() - (isoDow(jan4) - 1));
  const mon = new Date(mon1);
  mon.setUTCDate(mon1.getUTCDate() + (week - 1) * 7);
  return mon;
}

// The 7 dates (Mon..Sun) of "YYYY-Www" as YYYY-MM-DD strings
function weekDates(weekStr) {
  const mon = mondayOf(weekStr);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + i);
    return fmt(d);
  });
}

function prevWeek(weekStr) {
  const mon = mondayOf(weekStr);
  mon.setUTCDate(mon.getUTCDate() - 7);
  return weekString(fmt(mon));
}

// ---- calendar months ----

function parseMonth(monthStr) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new Error(`bad month: ${monthStr} (expected YYYY-MM)`);
  }
  return { year: Number(m[1]), month: Number(m[2]) };
}

// All dates of "YYYY-MM" as YYYY-MM-DD strings
function monthDates(monthStr) {
  const { year, month } = parseMonth(monthStr);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) =>
    `${monthStr}-${String(i + 1).padStart(2, '0')}`);
}

function prevMonth(monthStr) {
  const { year, month } = parseMonth(monthStr);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

module.exports = {
  isoWeekOf, weekString, weeksInYear, parseWeek, mondayOf, weekDates, prevWeek,
  parseMonth, monthDates, prevMonth,
};

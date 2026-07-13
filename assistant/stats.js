// WI-2 — aggregation engine. Pure deterministic functions, no LLM, no network.
// Every number that appears in a review is computed here and only here.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseFrontmatter, parseTable, parseCSVObjects } = require('./parse');
const { validateTransactions, hasErrors } = require('./validate');
const { weekDates, prevWeek, monthDates, prevMonth, weekString } = require('./isoweek');
const { HEADER } = require('./validate');

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// ---- entry point ------------------------------------------------------------
// kind: 'week' ('YYYY-Www') | 'month' ('YYYY-MM'). Returns a serializable
// PeriodStats object; `previous` holds the prior period's stats (one level, no
// recursion) or null when the prior period has no data at all.
function computePeriodStats(kind, period, cfg, { withPrevious = true } = {}) {
  const dates = kind === 'week' ? weekDates(period) : monthDates(period);
  const stats = {
    kind,
    period,
    dates: { from: dates[0], to: dates[dates.length - 1] },
    finance: financeStats(dates, cfg),
    exercise: habitStats('exercise', kind, period, dates, cfg),
    study: habitStats('study', kind, period, dates, cfg),
    journal: journalStats(dates, cfg),
    previous: null,
  };
  if (withPrevious) {
    const prevPeriod = kind === 'week' ? prevWeek(period) : prevMonth(period);
    const prev = computePeriodStats(kind, prevPeriod, cfg, { withPrevious: false });
    const hasData = prev.journal.entryCount > 0 || !prev.finance.missingFiles.length
      || !prev.exercise.missing || !prev.study.missing;
    stats.previous = hasData ? prev : null;
  }
  return stats;
}

// ---- finance -----------------------------------------------------------------
// `transfer` rows are excluded from ALL spending math (handoff §4). Amounts are
// converted to CAD via cfg.fx; the rates used are recorded in the result.
function financeStats(dates, cfg) {
  const dateSet = new Set(dates);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const rows = [];
  const missingFiles = [];
  const invalidFiles = [];
  for (const m of months) {
    const file = path.join(cfg.vault, 'finances', `${m}-transactions.csv`);
    if (!fs.existsSync(file)) { missingFiles.push(`${m}-transactions.csv`); continue; }
    if (hasErrors(validateTransactions(file))) { invalidFiles.push(`${m}-transactions.csv`); continue; }
    for (const r of parseCSVObjects(fs.readFileSync(file, 'utf8'), HEADER)) {
      if (dateSet.has(r.date)) rows.push(r);
    }
  }

  const fxUsed = {};
  const toCAD = (r) => {
    const rate = cfg.fx[r.currency];
    fxUsed[r.currency] = rate;
    return Number(r.amount) * rate;
  };

  let income = 0, fixed = 0, discretionary = 0, invest = 0;
  const perCategory = {};   // expenses only, CAD, positive numbers
  const discByCategory = {};
  const unplannedOver100 = [];
  for (const r of rows) {
    if (r.type === 'transfer') continue;
    const cad = toCAD(r);
    if (r.type === 'income') { income += cad; continue; }
    if (r.type === 'invest') { invest += Math.abs(cad); continue; }
    // expense (amounts are negative; aggregate as positive spend)
    const spend = Math.abs(cad);
    perCategory[r.category] = (perCategory[r.category] || 0) + spend;
    if (r.recurring === 'yes') {
      fixed += spend;
    } else {
      discretionary += spend;
      discByCategory[r.category] = (discByCategory[r.category] || 0) + spend;
      if (spend > 100) {
        unplannedOver100.push({
          date: r.date, description: r.description,
          amountCAD: round2(spend), original: `${r.amount} ${r.currency}`,
        });
      }
    }
  }

  const spending = fixed + discretionary;
  return {
    txCount: rows.length,
    incomeCAD: round2(income),
    fixedCAD: round2(fixed),
    discretionaryCAD: round2(discretionary),
    spendingCAD: round2(spending),
    investCAD: round2(invest),
    // savings rate = (income − spending) / income; invest is treated as saved.
    savingsRatePct: income > 0 ? round1(((income - spending) / income) * 100) : null,
    perCategoryCAD: mapRound(perCategory),
    top5Discretionary: Object.entries(discByCategory)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([category, cad]) => ({ category, cad: round2(cad) })),
    unplannedOver100,
    fxUsed,
    missingFiles,
    invalidFiles,
  };
}

function mapRound(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = round2(v);
  return out;
}

// ---- exercise & study ---------------------------------------------------------
// For a week: the single habits/<name>-YYYY-Www.md log. For a month: every log
// whose week overlaps the month, with rows filtered to dates inside the month.
// A missing weekly log => { missing: true } — never silently zero-filled.
function habitStats(name, kind, period, dates, cfg) {
  const dateSet = new Set(dates);
  const files = [];
  if (kind === 'week') {
    files.push(path.join(cfg.vault, 'habits', `${name}-${period}.md`));
  } else {
    const weeks = [...new Set(dates.map(weekString))];
    for (const w of weeks) files.push(path.join(cfg.vault, 'habits', `${name}-${w}.md`));
  }
  const found = files.filter((f) => fs.existsSync(f));
  if (!found.length) {
    return { missing: true, missingFiles: files.map((f) => path.basename(f)) };
  }
  const missingFiles = files.filter((f) => !fs.existsSync(f)).map((f) => path.basename(f));

  const rows = [];
  let targetSum = 0;
  const focusAreas = new Set();
  for (const f of found) {
    const { meta, body } = parseFrontmatter(fs.readFileSync(f, 'utf8'));
    targetSum += Number(meta[name === 'exercise' ? 'target_sessions' : 'target_hours'])
      || (name === 'exercise' ? 4 : 5);
    for (const a of (Array.isArray(meta.focus_areas) ? meta.focus_areas : [])) focusAreas.add(a);
    const table = parseTable(body);
    if (!table) continue;
    for (const r of table.rows) {
      if (r.date && dateSet.has(r.date)) rows.push(r);
    }
  }

  const minutes = rows.map((r) => Number(r.duration)).filter((n) => !Number.isNaN(n));
  const totalMin = minutes.reduce((s, n) => s + n, 0);
  const avg = (key) => {
    const ns = rows.map((r) => Number(r[key])).filter((n) => !Number.isNaN(n));
    return ns.length ? round1(ns.reduce((s, n) => s + n, 0) / ns.length) : null;
  };

  if (name === 'exercise') {
    const typeDist = {};
    for (const r of rows) if (r.type) typeDist[r.type] = (typeDist[r.type] || 0) + 1;
    return {
      missing: false, missingFiles,
      sessions: rows.length, target: targetSum,
      totalMin, avgIntensity: avg('intensity'), avgFeel: avg('feel'),
      typeDist,
    };
  }
  // study
  const perArea = {};
  let outputs = 0;
  for (const r of rows) {
    const min = Number(r.duration);
    if (r.area && !Number.isNaN(min)) perArea[r.area] = (perArea[r.area] || 0) + min;
    if (/^yes$/i.test(r.output || '')) outputs++;
  }
  return {
    missing: false, missingFiles,
    hours: round1(totalMin / 60), targetHours: targetSum,
    avgDepth: avg('depth'),
    outputRatio: rows.length ? round2(outputs / rows.length) : null,
    perAreaMin: perArea,
    focusAreas: [...focusAreas],
  };
}

// ---- journal -------------------------------------------------------------------
// Entries with unusable mood/energy/sleep frontmatter are excluded from the
// averages but still counted (and named) — handoff §5.
function journalStats(dates, cfg) {
  const present = [];
  const missingDates = [];
  const incompleteFrontmatter = [];
  for (const d of dates) {
    const file = path.join(cfg.vault, 'journal', `${d}.md`);
    if (!fs.existsSync(file)) { missingDates.push(d); continue; }
    const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const mood = Number(meta.mood);
    const energy = Number(meta.energy);
    const sleep = Number(meta.sleep_hours);
    const scaleOk = (n) => Number.isInteger(n) && n >= 1 && n <= 5;
    // meta value null/'' coerces to 0, which fails scaleOk — counted as incomplete
    if (scaleOk(mood) && scaleOk(energy) && !Number.isNaN(sleep) && sleep > 0) {
      present.push({ date: d, usable: true, mood, energy, sleep });
    } else {
      incompleteFrontmatter.push(d);
      present.push({ date: d, usable: false });
    }
  }
  const usable = present.filter((p) => p.usable);
  const avgOf = (key) => usable.length
    ? round1(usable.reduce((s, p) => s + p[key], 0) / usable.length) : null;
  return {
    entryCount: present.length,
    daysInPeriod: dates.length,
    avgMood: avgOf('mood'),
    avgEnergy: avgOf('energy'),
    avgSleep: avgOf('sleep'),
    missingDates,
    incompleteFrontmatter,
  };
}

// Raw journal bodies for the review prompt: [{ date, text }]
function journalTexts(kind, period, cfg) {
  const dates = kind === 'week' ? weekDates(period) : monthDates(period);
  const out = [];
  for (const d of dates) {
    const file = path.join(cfg.vault, 'journal', `${d}.md`);
    if (!fs.existsSync(file)) continue;
    const { body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    out.push({ date: d, text: body.trim() });
  }
  return out;
}

module.exports = { computePeriodStats, financeStats, habitStats, journalStats, journalTexts };

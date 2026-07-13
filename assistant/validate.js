// WI-1 — transactions CSV validator.
// Errors block review generation; duplicates are warn-only (per handoff §4).
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCSVObjects } = require('./parse');

const HEADER = ['date', 'account', 'type', 'category', 'subcategory',
  'description', 'amount', 'currency', 'recurring', 'notes'];
const TYPES = new Set(['expense', 'income', 'invest', 'transfer']);
const CATEGORIES = new Set(['Housing', 'Food', 'Transport', 'Family', 'Health',
  'Subscriptions', 'Shopping', 'Travel', 'Investing', 'Salary', 'Other']);
const CURRENCIES = new Set(['CAD', 'USD', 'KRW']);
const RECURRING = new Set(['yes', 'no']);

// -> [{ line, level: 'error'|'warn', msg }]
function validateTransactions(filePath) {
  const issues = [];
  const err = (line, msg) => issues.push({ line, level: 'error', msg });
  const warn = (line, msg) => issues.push({ line, level: 'warn', msg });

  const fm = /(\d{4})-(\d{2})-transactions\.csv$/.exec(path.basename(filePath));
  if (!fm) {
    err(0, `filename must be YYYY-MM-transactions.csv: ${path.basename(filePath)}`);
    return issues;
  }
  const fileMonth = `${fm[1]}-${fm[2]}`;

  let rows;
  try {
    rows = parseCSVObjects(fs.readFileSync(filePath, 'utf8'), HEADER);
  } catch (e) {
    err(1, e.message);
    return issues;
  }

  const seen = new Map(); // date|description|amount -> first line
  for (const r of rows) {
    const L = r._line;
    // date: parseable, real, inside the file's month
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || isRolledOver(r.date)) {
      err(L, `unparseable date "${r.date}"`);
    } else if (!r.date.startsWith(fileMonth + '-')) {
      err(L, `date ${r.date} outside file month ${fileMonth}`);
    }
    if (!TYPES.has(r.type)) err(L, `unknown type "${r.type}"`);
    if (!CATEGORIES.has(r.category)) err(L, `unknown category "${r.category}"`);
    if (!CURRENCIES.has(r.currency)) err(L, `unknown currency "${r.currency}"`);
    if (!RECURRING.has(r.recurring)) err(L, `recurring must be yes|no, got "${r.recurring}"`);
    // amount: numeric, no thousands separators
    if (!/^-?\d+(\.\d+)?$/.test(r.amount)) {
      err(L, `non-numeric amount "${r.amount}" (no thousands separators allowed)`);
    } else {
      const amt = Number(r.amount);
      if (r.type === 'expense' && amt >= 0) err(L, `expense with non-negative amount ${r.amount}`);
      if (r.type === 'income' && amt <= 0) err(L, `income with non-positive amount ${r.amount}`);
    }
    const key = `${r.date}|${r.description}|${r.amount}`;
    if (seen.has(key)) {
      warn(L, `possible duplicate of line ${seen.get(key)} (${r.date} "${r.description}" ${r.amount})`);
    } else {
      seen.set(key, L);
    }
  }
  return issues;
}

function isRolledOver(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateStr;
}

function formatReport(filePath, issues) {
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const lines = [`${path.basename(filePath)}: ${errors.length} error(s), ${warns.length} warning(s)`];
  for (const i of issues) {
    lines.push(`  ${i.level === 'error' ? '✖' : '⚠'} line ${i.line}: ${i.msg}`);
  }
  if (!issues.length) lines.push('  ✓ clean');
  return lines.join('\n');
}

function hasErrors(issues) {
  return issues.some((i) => i.level === 'error');
}

module.exports = { validateTransactions, formatReport, hasErrors, HEADER, TYPES, CATEGORIES, CURRENCIES };

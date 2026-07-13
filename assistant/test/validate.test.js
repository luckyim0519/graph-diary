'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateTransactions, hasErrors } = require('../validate');
const { CSV_JULY } = require('./fixtures');

function writeCsv(content, name = '2026-07-transactions.csv') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'la-test-csv-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

test('sample CSV passes clean', () => {
  const issues = validateTransactions(writeCsv(CSV_JULY));
  assert.deepEqual(issues, []);
});

test('bad category and wrong sign are errors', () => {
  const bad = CSV_JULY
    .replace('Food,groceries', 'Snacks,groceries')   // unknown category
    .replace(',-85,CAD', ',85,CAD');                 // expense with positive amount
  const issues = validateTransactions(writeCsv(bad));
  assert.equal(hasErrors(issues), true);
  assert.ok(issues.some((i) => i.msg.includes('unknown category "Snacks"')));
  assert.ok(issues.some((i) => i.msg.includes('non-negative amount')));
});

test('income with negative amount is an error', () => {
  const bad = CSV_JULY.replace('July salary,4000', 'July salary,-4000');
  assert.equal(hasErrors(validateTransactions(writeCsv(bad))), true);
});

test('date outside the file month is an error', () => {
  const bad = CSV_JULY.replace('2026-07-08,visa', '2026-08-08,visa');
  const issues = validateTransactions(writeCsv(bad));
  assert.ok(issues.some((i) => i.msg.includes('outside file month')));
});

test('unparseable and rolled-over dates are errors', () => {
  const bad = CSV_JULY.replace('2026-07-08', '2026-07-32');
  assert.ok(validateTransactions(writeCsv(bad))
    .some((i) => i.msg.includes('unparseable date')));
});

test('duplicates warn but do not block', () => {
  const dupRow = '2026-07-08,visa,expense,Food,restaurant,dinner out,-85,CAD,no,\n';
  const issues = validateTransactions(writeCsv(CSV_JULY + dupRow));
  assert.equal(hasErrors(issues), false);
  assert.ok(issues.some((i) => i.level === 'warn' && i.msg.includes('duplicate')));
});

test('unknown type/currency and comma amounts are errors', () => {
  const bad = CSV_JULY
    .replace('expense,Subscriptions', 'subscription,Subscriptions') // bad type
    .replace('-50000,KRW', '"-50,000",WON');                        // comma amount + bad currency
  const issues = validateTransactions(writeCsv(bad));
  assert.ok(issues.some((i) => i.msg.includes('unknown type')));
  assert.ok(issues.some((i) => i.msg.includes('unknown currency')));
  assert.ok(issues.some((i) => i.msg.includes('non-numeric amount')));
});

test('header mismatch is an error', () => {
  const issues = validateTransactions(writeCsv('date,amount\n2026-07-01,-5\n'));
  assert.equal(hasErrors(issues), true);
});

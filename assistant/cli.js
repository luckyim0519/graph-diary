#!/usr/bin/env node
// Life Assistant CLI. Usage:
//   npm run assistant -- validate 2026-07
//   npm run assistant -- review week 2026-W28 [--dry-run]
//   npm run assistant -- review month 2026-07 [--dry-run]
//   npm run assistant -- stats week 2026-W28
//   npm run assistant -- new journal [YYYY-MM-DD]
//   npm run assistant -- new logs [YYYY-Www]
// Vault override: GD_VAULT env var (used by tests; never point it at a copy of
// the real vault you intend to experiment on — copy first).
'use strict';
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./config');
const { validateTransactions, formatReport, hasErrors } = require('./validate');
const { computePeriodStats } = require('./stats');
const { generateReview } = require('./review');
const { newJournal, newHabitLogs } = require('./scaffold');

function usage(code = 1) {
  console.log('usage: assistant <validate YYYY-MM | review week YYYY-Www [--dry-run] | ' +
    'review month YYYY-MM [--dry-run] | stats <week|month> <period> | new journal [date] | new logs [week]>');
  process.exit(code);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const cfg = loadConfig();
  const cmd = args[0];

  if (cmd === 'validate') {
    const month = args[1] || usage();
    const file = path.join(cfg.vault, 'finances', `${month}-transactions.csv`);
    if (!fs.existsSync(file)) {
      console.error(`no such file: ${file}`);
      process.exit(1);
    }
    const issues = validateTransactions(file);
    console.log(formatReport(file, issues));
    process.exit(hasErrors(issues) ? 1 : 0);
  }

  if (cmd === 'stats') {
    const kind = args[1], period = args[2];
    if (!['week', 'month'].includes(kind) || !period) usage();
    console.log(JSON.stringify(computePeriodStats(kind, period, cfg), null, 2));
    return;
  }

  if (cmd === 'review') {
    const kind = args[1], period = args[2];
    if (!['week', 'month'].includes(kind) || !period) usage();
    const res = await generateReview(kind, period, cfg, { dryRun });
    for (const w of res.warnings || []) console.error(w);
    if (res.dryRun) {
      console.log('--- dry run: deterministic skeleton (no API call made) ---');
      console.log(res.skeleton);
    } else {
      console.log(`review written: ${res.path}`);
    }
    return;
  }

  if (cmd === 'new') {
    if (args[1] === 'journal') {
      const r = newJournal(cfg, args[2]);
      console.log(`${r.created ? 'created' : 'already exists'}: ${r.id}`);
      return;
    }
    if (args[1] === 'logs') {
      for (const r of newHabitLogs(cfg, args[2])) {
        console.log(`${r.created ? 'created' : 'already exists'}: ${r.id}`);
      }
      return;
    }
    usage();
  }

  usage(cmd ? 1 : 0);
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});

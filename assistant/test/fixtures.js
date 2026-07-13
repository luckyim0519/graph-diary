// Builds a throwaway vault in os.tmpdir() with one seeded week (2026-W28:
// Jul 6–12 2026) of sample data. NEVER points at the real vault.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const FX = { CAD: 1, USD: 1.35, KRW: 0.001 };

const JOURNALS = {
  '2026-07-06': { mood: 4, energy: 3, sleep: 7 },
  '2026-07-07': { mood: 3, energy: 3, sleep: 6.5 },
  '2026-07-08': { mood: 5, energy: 4, sleep: 8 },
  '2026-07-09': null, // present but incomplete frontmatter
  '2026-07-10': { mood: 2, energy: 2, sleep: 5 },
};

const CSV_JULY = `date,account,type,category,subcategory,description,amount,currency,recurring,notes
2026-07-01,checking,expense,Housing,rent,July rent,-1800,CAD,yes,
2026-07-06,checking,income,Salary,,July salary,4000,CAD,yes,
2026-07-07,visa,expense,Food,groceries,Superstore run,-120.50,CAD,no,
2026-07-08,visa,expense,Food,restaurant,dinner out,-85,CAD,no,
2026-07-09,visa,expense,Subscriptions,streaming,Netflix,-15,USD,yes,
2026-07-10,krw-account,expense,Family,,"gift, mom",-50000,KRW,no,
2026-07-11,checking,transfer,Other,,to savings,-500,CAD,no,
2026-07-12,checking,invest,Investing,etf,XEQT buy,-1000,CAD,no,
`;

function journalFile(date, vals) {
  const head = vals
    ? `mood: ${vals.mood}\nenergy: ${vals.energy}\nsleep_hours: ${vals.sleep}`
    : 'mood:\nenergy:\nsleep_hours:';
  return `---\ntype: journal\ndate: ${date}\nweek: 2026-W28\n${head}\ntags: [journal]\n---\n\n# ${date}\n\n## Mind\n\n오늘의 기록 ${date}.\n`;
}

const EXERCISE_W28 = `---
type: exercise-log
week: 2026-W28
target_sessions: 4
---

# Exercise — 2026-W28

| Date | Type | Detail | Duration (min) | Intensity (1–5) | Feel (1–5) | Notes |
|------|------|--------|----------------|-----------------|------------|-------|
| 2026-07-06 | Strength | push day | 60 | 4 | 4 | |
| 2026-07-08 | Run | easy 5k | 30 | 3 | 5 | |
| 2026-07-11 | Cycling | seawall | 90 | 4 | 3 | |
| 2026-07-13 | Run | belongs to next week | 40 | 3 | 3 | outside period |
`;

const STUDY_W28 = `---
type: study-log
week: 2026-W28
target_hours: 5
focus_areas: [ML, Korean]
---

# Study — 2026-W28

| Date | Area | What exactly | Duration (min) | Depth (1–5) | Output? (yes/no) |
|------|------|--------------|----------------|-------------|------------------|
| 2026-07-07 | ML | transformers paper | 120 | 4 | yes |
| 2026-07-09 | Korean | hanja drill | 60 | 3 | no |
| 2026-07-10 | ML | attention impl | 90 | 5 | yes |
`;

function buildVault({ exerciseLog = true } = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'la-test-vault-'));
  fs.mkdirSync(path.join(vault, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'habits'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'finances'), { recursive: true });
  for (const [date, vals] of Object.entries(JOURNALS)) {
    fs.writeFileSync(path.join(vault, 'journal', `${date}.md`), journalFile(date, vals));
  }
  if (exerciseLog) {
    fs.writeFileSync(path.join(vault, 'habits', 'exercise-2026-W28.md'), EXERCISE_W28);
  }
  fs.writeFileSync(path.join(vault, 'habits', 'study-2026-W28.md'), STUDY_W28);
  fs.writeFileSync(path.join(vault, 'finances', '2026-07-transactions.csv'), CSV_JULY);
  return vault;
}

function cfgFor(vault) {
  return { vault, fx: FX, model: 'claude-sonnet-4-6' };
}

module.exports = { buildVault, cfgFor, CSV_JULY, FX };

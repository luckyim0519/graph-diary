// WI-4a/b — instantiate templates for a new journal entry / weekly habit logs.
// Strictly additive: never overwrites an existing file.
'use strict';
const fs = require('fs');
const path = require('path');
const { weekString } = require('./isoweek');

// Local date, not UTC — an evening entry must not land on tomorrow's date.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fill(template, map) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] !== undefined ? map[k] : '');
}

// -> { id, created } where id is the app-style note id ("journal/2026-07-12.md")
function newJournal(cfg, date = today()) {
  const week = weekString(date);
  const dir = path.join(cfg.vault, 'journal');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.md`);
  if (fs.existsSync(file)) return { id: `journal/${date}.md`, created: false };
  const t = fs.readFileSync(path.join(cfg.templatesDir, 'journal-daily.md'), 'utf8');
  fs.writeFileSync(file, fill(t, { date, week }), 'utf8');
  return { id: `journal/${date}.md`, created: true };
}

// -> [{ id, created }] for both habit logs of the given week
function newHabitLogs(cfg, week = weekString(today())) {
  const dir = path.join(cfg.vault, 'habits');
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const name of ['exercise', 'study']) {
    const file = path.join(dir, `${name}-${week}.md`);
    if (fs.existsSync(file)) {
      out.push({ id: `habits/${name}-${week}.md`, created: false });
      continue;
    }
    const t = fs.readFileSync(path.join(cfg.templatesDir, `${name}-log.md`), 'utf8');
    fs.writeFileSync(file, fill(t, { week }), 'utf8');
    out.push({ id: `habits/${name}-${week}.md`, created: true });
  }
  return out;
}

module.exports = { newJournal, newHabitLogs, today };

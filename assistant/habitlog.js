// Habit UI backend (PRD-habit-ui): append-only row logging into the existing
// habits/<name>-YYYY-Www.md tables, plus range queries for the heatmaps.
// Never rewrites existing rows — corrections happen in the note editor.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseFrontmatter, parseTable } = require('./parse');
const { weekString } = require('./isoweek');
const { newHabitLogs } = require('./scaffold');

function esc(s) {
  // pipes would break the table row
  return String(s == null ? '' : s).replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim();
}

// Append one row to the week's log table (file created from template if absent).
// entry: exercise {date, type, detail, minutes, intensity, feel, notes}
//        study    {date, area, what, minutes, depth, output, notes?}
function logHabit(cfg, habit, entry) {
  if (!['exercise', 'study'].includes(habit)) throw new Error(`bad habit: ${habit}`);
  const date = entry.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date: ${date}`);
  const week = weekString(date);
  newHabitLogs(cfg, week); // ensures both week files exist; additive only
  const file = path.join(cfg.vault, 'habits', `${habit}-${week}.md`);

  const cells = habit === 'exercise'
    ? [date, esc(entry.type), esc(entry.detail), esc(entry.minutes),
       esc(entry.intensity), esc(entry.feel), esc(entry.notes)]
    : [date, esc(entry.area), esc(entry.what), esc(entry.minutes),
       esc(entry.depth), entry.output ? 'yes' : 'no'];

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) last = i;
  }
  if (last === -1) throw new Error(`no table found in ${path.basename(file)}`);
  lines.splice(last + 1, 0, `| ${cells.join(' | ')} |`);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return { id: `habits/${habit}-${week}.md`, week };
}

// All logged rows between fromDate..toDate (inclusive), keyed by day, plus
// this week's targets — feeds the heatmaps and progress bars.
function habitRange(cfg, habit, fromDate, toDate) {
  const dir = path.join(cfg.vault, 'habits');
  const byDay = {};
  const areas = new Set();
  let targetThisWeek = habit === 'exercise' ? 4 : 5;
  const thisWeek = weekString(toDate);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(habit + '-') || !f.endsWith('.md')) continue;
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (f === `${habit}-${thisWeek}.md`) {
        const t = Number(meta[habit === 'exercise' ? 'target_sessions' : 'target_hours']);
        if (!Number.isNaN(t) && t > 0) targetThisWeek = t;
      }
      const table = parseTable(body);
      if (!table) continue;
      for (const r of table.rows) {
        if (!r.date || r.date < fromDate || r.date > toDate) continue;
        (byDay[r.date] = byDay[r.date] || []).push({
          type: r.type || r.area || '',
          detail: r.detail || r.what || '',
          minutes: Number(r.duration) || 0,
          intensity: r.intensity, feel: r.feel, depth: r.depth,
          output: /^yes$/i.test(r.output || ''),
        });
        if (habit === 'study' && r.area) areas.add(r.area);
      }
      for (const a of (Array.isArray(meta.focus_areas) ? meta.focus_areas : [])) areas.add(a);
    }
  }
  return { byDay, areas: [...areas], targetThisWeek };
}

module.exports = { logHabit, habitRange };

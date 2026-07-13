// WI-3 — review generation. The only file that talks to a network, and only to
// the Anthropic API. Raw fetch (not the SDK) is a deliberate exception to the
// "use the official SDK" default: this repo has a hard zero-runtime-dependency
// rule (docs/PRD §9.3), and Node's built-in fetch suffices for one endpoint.
//
// Privacy rules (handoff §6): the prompt contains computed stats, journal text
// for the period, the template, and the prior review — never raw CSV rows or
// account identifiers. The assembled prompt is NEVER logged.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { computePeriodStats, journalTexts } = require('./stats');
const { validateTransactions, formatReport, hasErrors } = require('./validate');
const { weekDates, monthDates, prevWeek, prevMonth } = require('./isoweek');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// ---- API key: env var first, then macOS keychain (never stored in vault/repo)
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const out = execFileSync('security',
      ['find-generic-password', '-s', 'anthropic-api-key', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const key = out.trim();
    if (key) return key;
  } catch { /* keychain entry absent */ }
  throw new Error(
    'No API key: set ANTHROPIC_API_KEY or add a keychain item:\n' +
    '  security add-generic-password -s anthropic-api-key -a "$USER" -w <key>');
}

// ---- deterministic skeleton -------------------------------------------------
// Frontmatter + the numbers section are rendered in code so the model can never
// mangle a figure; the model only writes the narrative sections after them.

function fillPlaceholders(template, map) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    map[k] !== undefined && map[k] !== null ? String(map[k]) : 'not tracked');
}

function fmtDelta(cur, prevVal) {
  if (prevVal === undefined || prevVal === null) return '—';
  return String(prevVal);
}

function weeklySkeleton(template, s) {
  const p = s.previous;
  const fin = s.finance, ex = s.exercise, st = s.study, j = s.journal;
  return fillPlaceholders(template, {
    week: s.period,
    timestamp: new Date().toISOString(),
    fx_rates_used: JSON.stringify(fin.fxUsed),
    journal_count: j.entryCount,
    avg_mood: j.avgMood, avg_energy: j.avgEnergy, avg_sleep: j.avgSleep,
    prev_mood_energy_sleep: p ? `${p.journal.avgMood} / ${p.journal.avgEnergy} / ${p.journal.avgSleep}h` : '—',
    exercise_sessions: ex.missing ? 'no log' : ex.sessions,
    target_sessions: ex.missing ? '—' : ex.target,
    prev_exercise: p && !p.exercise.missing ? `${p.exercise.sessions}/${p.exercise.target}` : '—',
    study_hours: st.missing ? 'no log' : st.hours,
    target_hours: st.missing ? '—' : st.targetHours,
    prev_study: p && !p.study.missing ? `${p.study.hours}h` : '—',
    discretionary_cad: fin.discretionaryCAD,
    prev_discretionary: p ? fmtDelta(null, p.finance.discretionaryCAD) : '—',
    savings_rate: fin.savingsRatePct,
    prev_savings_rate: p ? fmtDelta(null, p.finance.savingsRatePct) : '—',
  });
}

function monthlySkeleton(template, s) {
  const head = fillPlaceholders(template, {
    month: s.period,
    timestamp: new Date().toISOString(),
    fx_rates_used: JSON.stringify(s.finance.fxUsed),
  });
  // "The month in numbers" content is injected as a deterministic block right
  // under its heading so the model never writes figures there.
  const fin = s.finance, j = s.journal, ex = s.exercise, st = s.study;
  const p = s.previous;
  const lines = [
    `- Journal: ${j.entryCount}/${j.daysInPeriod} entries · mood ${j.avgMood ?? 'not tracked'} · energy ${j.avgEnergy ?? 'not tracked'} · sleep ${j.avgSleep ?? 'not tracked'}h` +
      (p ? ` (prev: mood ${p.journal.avgMood ?? '—'})` : ''),
    ex.missing ? '- Exercise: no logs this month' :
      `- Exercise: ${ex.sessions} sessions (target ${ex.target}) · ${ex.totalMin} min · avg intensity ${ex.avgIntensity ?? '—'} · avg feel ${ex.avgFeel ?? '—'}`,
    st.missing ? '- Study: no logs this month' :
      `- Study: ${st.hours}h (target ${st.targetHours}) · avg depth ${st.avgDepth ?? '—'} · output ratio ${st.outputRatio ?? '—'}`,
    `- Money (CAD): income ${fin.incomeCAD} · fixed ${fin.fixedCAD} · discretionary ${fin.discretionaryCAD} · invest ${fin.investCAD} · savings rate ${fin.savingsRatePct ?? 'not tracked'}%`,
    `- Per category: ${Object.entries(fin.perCategoryCAD).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no expenses'}`,
    fin.unplannedOver100.length
      ? `- Unplanned >$100: ${fin.unplannedOver100.map((u) => `${u.description} (${u.amountCAD})`).join(', ')}`
      : '- Unplanned >$100: none',
  ];
  if (fin.missingFiles.length) lines.push(`- Missing transaction files: ${fin.missingFiles.join(', ')}`);
  return head.replace(/(## The month in numbers\n)/, `$1\n${lines.join('\n')}\n`);
}

// ---- prompt assembly ----------------------------------------------------------

function buildPrompt(kind, period, skeleton, stats, texts, prevReview, cfg) {
  const claudeMd = fs.readFileSync(cfg.claudeMd, 'utf8');
  const system =
    'You are the Life Assistant review writer. Your full behavior spec follows; obey it exactly.\n\n' +
    claudeMd +
    '\n\nOutput rules: return ONLY the completed markdown document. Start from the partially-' +
    'filled document provided in <skeleton> — keep its frontmatter and every already-filled ' +
    'line verbatim, and replace each <!-- LLM: ... --> comment with the narrative it describes. ' +
    'Replace <!-- Generator: ... --> comments in the Sources section with the wikilink list ' +
    'provided in <sources>. Never alter or invent a number.';
  const user = [
    `<period kind="${kind}">${period}</period>`,
    `<stats>\n${JSON.stringify(stats, null, 2)}\n</stats>`,
    `<journal>\n${texts.map((t) => `### ${t.date}\n${t.text}`).join('\n\n') || '(no journal entries this period)'}\n</journal>`,
    `<previous_review>\n${prevReview || '(none — this is the first review of its kind)'}\n</previous_review>`,
    `<sources>\n${sourceLinks(kind, period, stats, cfg)}\n</sources>`,
    `<skeleton>\n${skeleton}\n</skeleton>`,
  ].join('\n\n');
  return { system, user };
}

function sourceLinks(kind, period, stats, cfg) {
  const links = [];
  const dates = kind === 'week' ? weekDates(period) : monthDates(period);
  for (const d of dates) {
    if (fs.existsSync(path.join(cfg.vault, 'journal', `${d}.md`))) links.push(`[[${d}]]`);
  }
  if (kind === 'week') {
    if (!stats.exercise.missing) links.push(`[[exercise-${period}]]`);
    if (!stats.study.missing) links.push(`[[study-${period}]]`);
  } else {
    const weeks = [...new Set(dates.map(require('./isoweek').weekString))];
    for (const w of weeks) {
      if (fs.existsSync(path.join(cfg.vault, 'reviews', `weekly-${w}.md`))) links.push(`[[weekly-${w}]]`);
    }
  }
  return links.join(' · ') || '(no source files found)';
}

// ---- API call ------------------------------------------------------------------

async function callClaude(system, user, cfg) {
  const key = apiKey();
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 16000,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
    } catch (e) {
      lastErr = new Error(`network error calling Anthropic API: ${e.message}`);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Anthropic API ${res.status} (retryable)`);
      continue;
    }
    if (!res.ok) {
      // Error bodies contain an error type/message, never the prompt.
      let msg = `Anthropic API ${res.status}`;
      try {
        const body = await res.json();
        msg += `: ${body.error && body.error.type} — ${body.error && body.error.message}`;
      } catch { /* keep status-only message */ }
      throw new Error(msg);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('model declined the request (stop_reason: refusal) — nothing written');
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('review truncated (stop_reason: max_tokens) — nothing written');
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text.trim()) throw new Error('empty response from model — nothing written');
    return text;
  }
  throw lastErr || new Error('Anthropic API: retries exhausted');
}

// ---- guard: splice our deterministic head back over the model's copy -----------
// Everything up to and including the injected-numbers section comes from code,
// even if the model transcribed it imperfectly.

function spliceHead(skeleton, modelDoc, firstNarrativeHeading) {
  const cut = (doc) => {
    const i = doc.indexOf(firstNarrativeHeading);
    return i === -1 ? null : { head: doc.slice(0, i), tail: doc.slice(i) };
  };
  const ours = cut(skeleton);
  const theirs = cut(modelDoc);
  if (!ours || !theirs) return modelDoc; // template drifted; trust the model doc
  return ours.head + theirs.tail;
}

// ---- entry point ----------------------------------------------------------------

async function generateReview(kind, period, cfg, { dryRun = false } = {}) {
  // 1. Validate every transactions CSV the period touches — errors block.
  const dates = kind === 'week' ? weekDates(period) : monthDates(period);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const reports = [];
  for (const m of months) {
    const file = path.join(cfg.vault, 'finances', `${m}-transactions.csv`);
    if (!fs.existsSync(file)) continue;
    const issues = validateTransactions(file);
    if (issues.length) reports.push(formatReport(file, issues));
    if (hasErrors(issues)) {
      throw new Error(`transactions CSV has errors — review blocked:\n${formatReport(file, issues)}`);
    }
  }

  // 2. Gather.
  const stats = computePeriodStats(kind, period, cfg);
  const texts = journalTexts(kind, period, cfg);
  const templateFile = path.join(cfg.templatesDir, kind === 'week' ? 'weekly-review.md' : 'monthly-review.md');
  const template = fs.readFileSync(templateFile, 'utf8');
  const skeleton = kind === 'week' ? weeklySkeleton(template, stats) : monthlySkeleton(template, stats);

  const prevPeriod = kind === 'week' ? prevWeek(period) : prevMonth(period);
  const prevFile = path.join(cfg.vault, 'reviews',
    kind === 'week' ? `weekly-${prevPeriod}.md` : `monthly-${prevPeriod}.md`);
  const prevReview = fs.existsSync(prevFile) ? fs.readFileSync(prevFile, 'utf8') : null;

  const { system, user } = buildPrompt(kind, period, skeleton, stats, texts, prevReview, cfg);

  if (dryRun) {
    return { dryRun: true, skeleton, warnings: reports, stats };
  }

  // 3. Generate.
  const modelDoc = await callClaude(system, user, cfg);
  const firstHeading = kind === 'week' ? '## Body' : '## Weekly arc';
  const finalDoc = spliceHead(skeleton, modelDoc, firstHeading);

  // 4. Write — archive any existing review first (additive, never deletes).
  const outDir = path.join(cfg.vault, 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir,
    kind === 'week' ? `weekly-${period}.md` : `monthly-${period}.md`);
  if (fs.existsSync(outFile)) {
    const archive = path.join(outDir, '.archive');
    fs.mkdirSync(archive, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(outFile, path.join(archive, `${stamp}__${path.basename(outFile)}`));
  }
  fs.writeFileSync(outFile, finalDoc, 'utf8');
  return { path: outFile, warnings: reports };
}

module.exports = { generateReview };

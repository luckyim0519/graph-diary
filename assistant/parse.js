// Strict parsers for the life-assistant file formats (frontmatter, markdown
// tables, CSV). Deliberately separate from the app's tolerant parser in
// main.js — validation needs strictness the app doesn't.
'use strict';

// ---- frontmatter ------------------------------------------------------------
// Flat key: value pairs; values may be numbers, inline lists [a, b], or strings.
// Returns { meta, body, present }.
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw, present: false };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    meta[kv[1]] = parseValue(kv[2].trim());
  }
  return { meta, body: raw.slice(m[0].length), present: true };
}

function parseValue(v) {
  if (v === '') return null;
  const list = /^\[(.*)\]$/.exec(v);
  if (list) {
    return list[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// ---- markdown tables --------------------------------------------------------
// Finds the first pipe table in `body`. Returns { header: [names], rows: [obj] }
// where each row object is keyed by a normalized header name (lowercased, first
// word only: "Duration (min)" -> "duration", "Output? (yes/no)" -> "output").
// Rows whose cells are all empty are skipped; a missing table returns null.
function parseTable(body) {
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !isTableLine(lines[i])) i++;
  if (i >= lines.length || !isSeparator(lines[i + 1] || '')) return null;
  const header = cells(lines[i]);
  const keys = header.map(normalizeHeader);
  const rows = [];
  for (let j = i + 2; j < lines.length && isTableLine(lines[j]); j++) {
    const cs = cells(lines[j]);
    if (cs.every((c) => c === '')) continue;
    const row = {};
    keys.forEach((k, idx) => { row[k] = cs[idx] !== undefined ? cs[idx] : ''; });
    rows.push(row);
  }
  return { header, rows };
}

function isTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}
function isSeparator(line) {
  return isTableLine(line) && /^[\s|:-]+$/.test(line);
}
function cells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
}
function normalizeHeader(h) {
  const w = h.toLowerCase().match(/[a-z가-힣]+/);
  return w ? w[0] : h.toLowerCase();
}

// ---- CSV ---------------------------------------------------------------------
// RFC-4180-ish state machine: quoted fields, embedded commas/quotes, CRLF.
// Returns array of string arrays (first row = header).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

// CSV rows as objects keyed by header names. Throws on a header mismatch.
function parseCSVObjects(text, expectedHeader) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  if (expectedHeader && header.join(',') !== expectedHeader.join(',')) {
    throw new Error(
      `CSV header mismatch: expected "${expectedHeader.join(',')}", got "${header.join(',')}"`);
  }
  return rows.slice(1).map((r, idx) => {
    const o = { _line: idx + 2 }; // 1-based line number incl. header
    header.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i].trim() : ''; });
    return o;
  });
}

module.exports = { parseFrontmatter, parseTable, parseCSV, parseCSVObjects };

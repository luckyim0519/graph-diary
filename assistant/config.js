// Loads assistant/config.yaml — a deliberately tiny two-level YAML subset
// (top-level keys + one level of indented maps), enough for fx rates and
// simple settings without a YAML dependency.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_VAULT = path.join(
  os.homedir(), 'Library', 'Application Support', 'graph-diary', 'vault');

function parseMiniYaml(text) {
  const out = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const nested = /^\s+([\w-]+):[ \t]*(.*)$/.exec(line);
    const top = /^([\w-]+):[ \t]*(.*)$/.exec(line);
    if (top && !/^\s/.test(line)) {
      if (top[2] === '') { out[top[1]] = {}; current = top[1]; }
      else { out[top[1]] = coerce(top[2]); current = null; }
    } else if (nested && current) {
      out[current][nested[1]] = coerce(nested[2]);
    }
  }
  return out;
}

function coerce(v) {
  const s = v.trim().replace(/^['"]|['"]$/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
}

function loadConfig(overrides = {}) {
  const file = path.join(__dirname, 'config.yaml');
  const cfg = fs.existsSync(file) ? parseMiniYaml(fs.readFileSync(file, 'utf8')) : {};
  const fx = { CAD: 1, ...(cfg.fx || {}) };
  let vault = overrides.vault || process.env.GD_VAULT || cfg.vault || DEFAULT_VAULT;
  if (vault.startsWith('~')) vault = path.join(os.homedir(), vault.slice(1));
  return {
    fx,
    model: cfg.model || 'claude-sonnet-4-6',
    vault,
    templatesDir: path.join(__dirname, '..', 'life-assistant', 'templates'),
    claudeMd: path.join(__dirname, '..', 'life-assistant', 'CLAUDE.md'),
  };
}

module.exports = { loadConfig, parseMiniYaml, DEFAULT_VAULT };

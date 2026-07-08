// ---- State ----------------------------------------------------------------
let notes = [];
let categories = [];
let currentId = null;
let saveTimer = null;
let dirty = false; // true when the editor has unsaved changes

const PALETTE = [
  '#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68',
  '#f7768e', '#7dcfff', '#ff9e64', '#73daca',
];
const catColors = {};
function colorFor(cat) {
  if (catColors[cat]) return catColors[cat];
  const idx = Object.keys(catColors).length;
  if (idx < PALETTE.length) {
    catColors[cat] = PALETTE[idx];
  } else {
    // deterministic HSL from hash for 9th+ categories
    let h = 0;
    for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
    catColors[cat] = `hsl(${h % 360}, 65%, 62%)`;
  }
  return catColors[cat];
}

// ---- DOM ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const tree = $('tree');
const editor = $('editor');
const noteTitle = $('note-title');
const noteCat = $('note-cat');
const saveState = $('save-state');
const autocomplete = $('autocomplete');
let graph;

// ---- Loading --------------------------------------------------------------
async function refresh() {
  notes = await window.api.listNotes();
  categories = await window.api.listCategories();
  categories.forEach(colorFor);
  renderTree();
  refreshThemeList();
  if (graph) updateGraph();
}

function renderTree() {
  tree.innerHTML = '';
  // Top level = year (newest first), then category → theme → sub-theme.
  const years = [...new Set(notes.map(yearOf))].sort().reverse();
  for (const year of years) {
    const yearGroup = document.createElement('div');
    yearGroup.className = 'year-group';
    const yhead = document.createElement('div');
    yhead.className = 'year-head';
    yhead.textContent = '📅 ' + year;
    yearGroup.appendChild(yhead);

    const yearNotes = notes.filter((n) => yearOf(n) === year);
    for (const cat of categories) {
      const catNotes = yearNotes.filter((n) => n.category === cat);
      if (catNotes.length) renderCategory(yearGroup, cat, catNotes);
    }
    tree.appendChild(yearGroup);
  }
}

function renderCategory(parent, cat, catNotesUnsorted) {
  const group = document.createElement('div');
  group.className = 'cat-group';
  {
    // drop on the category → move here (keeping the note's theme/sub-theme)
    makeDropZone(group, (id) =>
      id.startsWith(cat + '/') ? null : window.api.moveNote(id, cat));

    const head = document.createElement('div');
    head.className = 'cat-head';
    head.innerHTML = `<span class="cat-dot" style="background:${colorFor(cat)}"></span>${prettify(cat)}`;
    group.appendChild(head);

    const catNotes = [...catNotesUnsorted].sort((a, b) => a.title.localeCompare(b.title));

    const addItem = (n, cls) => {
      const item = document.createElement('div');
      item.className = 'note-item' + (cls ? ' ' + cls : '') +
        (n.id === currentId ? ' active' : '');
      item.textContent = n.title;
      item.onclick = () => openNote(n.id);
      // make the note draggable between categories
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', n.id);
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      group.appendChild(item);
    };
    const addHead = (cls, text, resolver) => {
      const h = document.createElement('div');
      h.className = cls;
      h.textContent = text;
      if (resolver) makeDropZone(h, resolver);
      group.appendChild(h);
    };

    // notes with no theme listed directly under the category
    for (const n of catNotes.filter((n) => !n.theme)) addItem(n, '');

    // theme sub-group → sub-theme sub-sub-group → notes
    const themes = [...new Set(catNotes.map((n) => n.theme).filter(Boolean))].sort();
    for (const th of themes) {
      // drop on a theme → set this category + theme, clear sub-theme
      addHead('theme-head', th, (id) => window.api.reclassifyNote(id, cat, th, ''));
      const themeNotes = catNotes.filter((n) => n.theme === th);
      // notes in this theme with no sub-theme
      for (const n of themeNotes.filter((n) => !n.subtheme)) addItem(n, 'themed');
      // then a sub-sub-group per sub-theme
      const subs = [...new Set(themeNotes.map((n) => n.subtheme).filter(Boolean))].sort();
      for (const sub of subs) {
        // drop on a sub-theme → set this category + theme + sub-theme
        addHead('subtheme-head', sub, (id) => window.api.reclassifyNote(id, cat, th, sub));
        for (const n of themeNotes.filter((n) => n.subtheme === sub)) {
          addItem(n, 'subthemed');
        }
      }
    }
    parent.appendChild(group);
  }
}

function prettify(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Turn an element into a drop target. `resolver(draggedId)` returns the new id
// (or null for a no-op). Used for category groups, theme and sub-theme headers.
function makeDropZone(el, resolver) {
  const isGroup = el.classList.contains('cat-group');
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
    // when hovering a header, don't also highlight the whole category
    if (!isGroup) el.closest('.cat-group')?.classList.remove('drop-target');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const newId = await resolver(id);
    if (!newId) return;
    await refresh();
    openNote(newId);
  });
}

// ---- Editor ---------------------------------------------------------------
async function openNote(id) {
  // never lose the entry we're leaving — flush it first
  if (currentId && currentId !== id && dirty) {
    clearTimeout(saveTimer);
    await saveCurrent();
  }
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  currentId = id;
  editor.value = note.content;
  noteTitle.textContent = note.title;
  noteCat.textContent = prettify(note.category);
  $('note-year-input').value = /^\d{4}/.test(note.date || '') ? note.date.slice(0, 4) : '';
  $('note-year').textContent = yearOf(note);
  $('note-theme').value = note.theme || '';
  $('note-subtheme').value = note.subtheme || '';
  renderKeywords(note.keywords);
  dirty = false; // freshly loaded note has nothing unsaved
  saveState.textContent = '';
  renderTree();
  if (graph) graph.setActive(id);
  // make sure we're on the editor tab
  switchTab('editor');
  editor.focus();
}

editor.addEventListener('input', () => {
  if (!currentId) return;
  const note = notes.find((n) => n.id === currentId);
  if (note) note.content = editor.value;
  dirty = true;
  saveState.textContent = 'unsaved…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 500);
  handleAutocomplete();
});

// Clicking away from the editor saves right away.
editor.addEventListener('blur', () => {
  if (currentId && dirty) { clearTimeout(saveTimer); saveCurrent(); }
});

// The note's year is derived from its date (the top-level grouping).
function yearOf(note) {
  const d = note && note.date ? String(note.date) : '';
  return /^\d{4}/.test(d) ? d.slice(0, 4) : 'undated';
}

async function saveCurrent() {
  if (!currentId) return;
  const note = notes.find((n) => n.id === currentId);
  if (!note) return;
  note.theme = $('note-theme').value.trim();
  note.subtheme = $('note-subtheme').value.trim();
  const yr = $('note-year-input').value.trim();
  if (yr) note.date = yr; // store the year only (e.g. "2026")
  $('note-year').textContent = yearOf(note);
  const res = await window.api.saveNote(
    currentId, editor.value, note.theme, note.subtheme, note.date);
  // keywords are re-derived from the body on every save
  note.keywords = (res && res.keywords) || [];
  renderKeywords(note.keywords);
  // title may have changed (first # heading)
  const m = editor.value.match(/^#\s+(.+)$/m);
  note.title = m ? m[1].trim() : note.slug;
  noteTitle.textContent = note.title;
  note.mood = null;        // body changed → mood is stale until re-analyzed
  moodLoaded = false;      // re-run analysis next time the Mood tab opens
  dirty = false;
  saveState.textContent = 'saved ✓';
  renderTree();
  refreshThemeList();
  if (graph) updateGraph();
}

// Last line of defence: if the window is closing with unsaved text,
// write it synchronously so nothing is ever lost.
window.addEventListener('beforeunload', () => {
  if (currentId && dirty) {
    window.api.saveNoteSync(
      currentId, editor.value,
      $('note-theme').value.trim(), $('note-subtheme').value.trim(),
      $('note-year-input').value.trim());
    dirty = false;
  }
});

// Editing a theme box / date saves immediately (so groupings re-cluster).
$('note-theme').addEventListener('change', () => { if (currentId) saveCurrent(); });
$('note-year-input').addEventListener('change', () => { if (currentId) saveCurrent(); });
$('note-subtheme').addEventListener('change', () => { if (currentId) saveCurrent(); });

function refreshThemeList() {
  const themes = [...new Set(notes.map((n) => n.theme).filter(Boolean))].sort();
  $('theme-list').innerHTML = themes.map((t) => `<option value="${t}">`).join('');
  const subs = [...new Set(notes.map((n) => n.subtheme).filter(Boolean))].sort();
  $('subtheme-list').innerHTML = subs.map((t) => `<option value="${t}">`).join('');
}

function renderKeywords(keywords) {
  const box = $('note-keywords');
  if (!keywords || !keywords.length) {
    box.innerHTML = '<span class="kw-label">keywords: (start writing…)</span>';
    return;
  }
  box.innerHTML = '<span class="kw-label">keywords:</span>' +
    keywords.map((k) => `<span class="kw-chip">${k}</span>`).join('');
}

// ---- [[ wiki-link ]] autocomplete ----------------------------------------
let acActive = false;
let acIndex = 0;
let acMatches = [];
let acStart = -1;

function handleAutocomplete() {
  const pos = editor.selectionStart;
  const text = editor.value.slice(0, pos);
  const open = text.lastIndexOf('[[');
  const close = text.lastIndexOf(']]');
  if (open === -1 || close > open) return hideAutocomplete();
  const query = text.slice(open + 2);
  if (query.includes('\n')) return hideAutocomplete();
  acStart = open;

  const q = query.toLowerCase();
  acMatches = notes
    .filter((n) => n.id !== currentId && n.title.toLowerCase().includes(q))
    .slice(0, 8);

  if (query.trim() && !notes.some((n) => n.title.toLowerCase() === q)) {
    acMatches.push({ create: true, title: query.trim() });
  }
  if (!acMatches.length) return hideAutocomplete();

  acIndex = 0;
  renderAutocomplete();
}

function renderAutocomplete() {
  autocomplete.innerHTML = '';
  acMatches.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'ac-item' + (i === acIndex ? ' sel' : '') + (m.create ? ' create' : '');
    if (m.create) {
      el.innerHTML = `+ Create “${m.title}”`;
    } else {
      el.innerHTML = `<span>${m.title}</span><span class="ac-cat">${prettify(m.category)}</span>`;
    }
    el.onmousedown = (e) => { e.preventDefault(); chooseAutocomplete(i); };
    autocomplete.appendChild(el);
  });
  positionAutocomplete();
  autocomplete.classList.remove('hidden');
  acActive = true;
}

function positionAutocomplete() {
  // approximate caret position using a mirror div
  const coords = caretCoords();
  autocomplete.style.left = coords.left + 'px';
  autocomplete.style.top = coords.top + 'px';
}

function caretCoords() {
  const div = document.createElement('div');
  const style = getComputedStyle(editor);
  for (const p of ['fontFamily','fontSize','lineHeight','padding','border','width','whiteSpace','wordWrap']) {
    div.style[p] = style[p];
  }
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.textContent = editor.value.slice(0, editor.selectionStart);
  const span = document.createElement('span');
  span.textContent = '​';
  div.appendChild(span);
  document.body.appendChild(div);
  const wrap = $('editor-wrap').getBoundingClientRect();
  const er = editor.getBoundingClientRect();
  const top = er.top - wrap.top + span.offsetTop - editor.scrollTop + 22;
  const left = er.left - wrap.left + span.offsetLeft + 4;
  document.body.removeChild(div);
  return { top, left };
}

async function chooseAutocomplete(i) {
  const m = acMatches[i];
  let title = m.title;
  if (m.create) {
    // create in the same category as the current note
    const note = notes.find((n) => n.id === currentId);
    const cat = note ? note.category : (categories[0] || 'notes');
    const newId = await window.api.createNote(cat, title);
    await refresh();
  }
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, acStart);
  const after = editor.value.slice(pos);
  editor.value = before + `[[${title}]]` + after;
  const caret = (before + `[[${title}]]`).length;
  editor.setSelectionRange(caret, caret);
  hideAutocomplete();
  editor.focus();
  // persist + sync state
  const note = notes.find((n) => n.id === currentId);
  if (note) note.content = editor.value;
  saveCurrent();
}

function hideAutocomplete() {
  autocomplete.classList.add('hidden');
  acActive = false;
}

editor.addEventListener('keydown', (e) => {
  if (!acActive) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = (acIndex + 1) % acMatches.length; renderAutocomplete(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = (acIndex - 1 + acMatches.length) % acMatches.length; renderAutocomplete(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseAutocomplete(acIndex); }
  else if (e.key === 'Escape') { hideAutocomplete(); }
});

// Click a [[link]] (ctrl/cmd+click) in the textarea to follow it.
editor.addEventListener('click', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const pos = editor.selectionStart;
  const text = editor.value;
  // find a [[...]] surrounding the caret
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (pos >= m.index && pos <= m.index + m[0].length) {
      followLink(m[1].trim());
      break;
    }
  }
});

function followLink(title) {
  const target = notes.find((n) => n.title.toLowerCase() === title.toLowerCase()
    || n.slug.toLowerCase() === title.toLowerCase());
  if (target) openNote(target.id);
}

// ---- Graph ----------------------------------------------------------------
let showKeywordBridges = false;

function buildGraphData() {
  const byKey = new Map();
  for (const n of notes) {
    byKey.set(n.title.toLowerCase(), n);
    byKey.set(n.slug.toLowerCase(), n);
  }
  const edgeMap = new Map();
  const pairKey = (a, b) => [a, b].sort().join('|');
  const addEdge = (aId, bId, type, shared) => {
    if (aId === bId) return;
    const key = pairKey(aId, bId);
    const existing = edgeMap.get(key);
    if (existing) {
      if (type === 'link') existing.type = 'link'; // links take priority over keyword bridges
      if (shared) existing.shared = [...new Set([...existing.shared, ...shared])];
      return;
    }
    edgeMap.set(key, { source: aId, target: bId, type, shared: shared || [] });
  };

  // 1) [[wiki-links]] — cross-category allowed; these are first-class edges
  for (const n of notes) {
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(n.content))) {
      const target = byKey.get(m[1].trim().toLowerCase());
      if (target && target.id !== n.id) {
        addEdge(n.id, target.id, 'link', []);
      }
    }
  }

  // 2) keyword bridges — secondary, require ≥2 shared keywords
  for (let i = 0; i < notes.length; i++) {
    const a = notes[i];
    const aKw = new Set(a.keywords || []);
    if (!aKw.size) continue;
    for (let j = i + 1; j < notes.length; j++) {
      const b = notes[j];
      const shared = (b.keywords || []).filter((k) => aKw.has(k));
      if (shared.length >= 2) {
        addEdge(a.id, b.id, 'keyword', shared);
      }
    }
  }

  const nodes = notes.map((n) => ({
    id: n.id, title: n.title, category: n.category,
    theme: n.theme || '', subtheme: n.subtheme || '', year: yearOf(n),
  }));
  return { nodes, edges: [...edgeMap.values()] };
}

function updateGraph() {
  const { nodes, edges } = buildGraphData();
  const filtered = showKeywordBridges ? edges : edges.filter((e) => e.type !== 'keyword');
  graph.setData(nodes, filtered, catColors, categories);
  graph.setActive(currentId);
  renderLegend();
}

function renderLegend() {
  const legend = $('graph-legend');
  const cats = categories
    .map((c) => `<div class="legend-row"><span class="legend-dot" style="background:${colorFor(c)}"></span>${prettify(c)}</div>`)
    .join('');
  legend.innerHTML = cats +
    '<div class="legend-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">' +
    `<label style="display:flex;align-items:center;gap:6px;cursor:pointer">` +
    `<input type="checkbox" id="kw-bridge-toggle"${showKeywordBridges ? ' checked' : ''}>` +
    `<span style="width:18px;border-top:2px dashed #bb9af7;display:inline-block"></span>keyword bridges (≥2 shared)</label></div>`;

  const toggle = document.getElementById('kw-bridge-toggle');
  if (toggle) {
    toggle.addEventListener('change', () => {
      showKeywordBridges = toggle.checked;
      updateGraph();
    });
  }
}

// ---- Tabs -----------------------------------------------------------------
function switchTab(which) {
  for (const t of ['editor', 'graph', 'mood']) {
    $('tab-' + t).classList.toggle('active', which === t);
    $(t + '-view').classList.toggle('hidden', which !== t);
  }
  if (which === 'graph') {
    graph.resize();
    updateGraph();
    graph.start();
  } else {
    graph.stop();
  }
  if (which === 'mood') openMood();
}

$('tab-editor').onclick = () => switchTab('editor');
$('tab-graph').onclick = () => switchTab('graph');
$('tab-mood').onclick = () => switchTab('mood');

// ---- Mood / emotional arc -------------------------------------------------
let moodChart;
let moodLoaded = false;

async function openMood() {
  const status = await window.api.ollamaStatus();
  $('mood-engine').innerHTML = status.reachable
    ? `Analysis engine: <b>Ollama (${status.model})</b> · local & private`
    : 'Analysis engine: <b>built-in</b> · install Ollama for richer insight';
  moodChart.resize();
  if (!moodLoaded) {
    await runMoodAnalysis(false); // analyze only entries missing a mood
    moodLoaded = true;
  } else {
    renderMood();
  }
}

async function runMoodAnalysis(force) {
  $('mood-engine').innerHTML += ' · <i>analyzing…</i>';
  const results = await window.api.analyzeMoods(force);
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const n of notes) {
    const r = byId.get(n.id);
    if (r) { n.mood = r.mood; n.emotions = r.emotions; }
  }
  await openMoodStatus();
  renderMood();
}

async function openMoodStatus() {
  const status = await window.api.ollamaStatus();
  $('mood-engine').innerHTML = status.reachable
    ? `Analysis engine: <b>Ollama (${status.model})</b> · local & private`
    : 'Analysis engine: <b>built-in</b> · install Ollama for richer insight';
}

function renderMood() {
  const points = notes
    .filter((n) => typeof n.mood === 'number')
    .map((n) => ({
      id: n.id, title: n.title, date: n.date, mood: n.mood,
      category: n.category, color: colorFor(n.category), emotions: n.emotions || [],
    }));
  moodChart.setData(points);
  renderMoodSummary(points);
}

function renderMoodSummary(points) {
  const box = $('mood-summary');
  if (!points.length) { box.innerHTML = ''; return; }
  const avg = points.reduce((s, p) => s + p.mood, 0) / points.length;
  const best = points.reduce((a, b) => (b.mood > a.mood ? b : a));
  const worst = points.reduce((a, b) => (b.mood < a.mood ? b : a));

  // which themes/keywords track your best vs worst days
  const tag = (sel) => {
    const freq = {};
    for (const p of points) {
      if (!sel(p.mood)) continue;
      const note = notes.find((n) => n.id === p.id);
      for (const k of (note.keywords || [])) freq[k] = (freq[k] || 0) + 1;
      if (note.theme) freq[note.theme] = (freq[note.theme] || 0) + 1;
    }
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  };
  const highTags = tag((m) => m > 0);
  const lowTags = tag((m) => m < 0);

  const card = (label, value, sub) =>
    `<div class="mood-card"><div class="mc-label">${label}</div>` +
    `<div class="mc-value">${value}</div><div class="mc-sub">${sub}</div></div>`;

  box.innerHTML =
    card('Average mood', (avg > 0 ? '+' : '') + avg.toFixed(1), `${points.length} entries`) +
    card('Best day', `${best.mood > 0 ? '+' : ''}${best.mood}`, `${best.title} · ${best.date}`) +
    card('Lowest day', `${worst.mood}`, `${worst.title} · ${worst.date}`) +
    card('On good days', highTags.join(', ') || '—', 'common themes') +
    card('On hard days', lowTags.join(', ') || '—', 'common themes');
}

$('mood-refresh').onclick = () => runMoodAnalysis(true);

// ---- Modal helper ---------------------------------------------------------
function modal({ title, withSelect, options, placeholder }) {
  return new Promise((resolve) => {
    const m = $('modal');
    $('modal-title').textContent = title;
    const input = $('modal-input');
    const select = $('modal-select');
    input.value = '';
    input.placeholder = placeholder || '';
    if (withSelect) {
      select.classList.remove('hidden');
      select.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    } else {
      select.classList.add('hidden');
    }
    m.classList.remove('hidden');
    setTimeout(() => input.focus(), 30);

    const done = (val) => {
      m.classList.add('hidden');
      $('modal-ok').onclick = null;
      $('modal-cancel').onclick = null;
      input.onkeydown = null;
      resolve(val);
    };
    $('modal-ok').onclick = () => done({ text: input.value.trim(), select: select.value });
    $('modal-cancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done({ text: input.value.trim(), select: select.value });
      if (e.key === 'Escape') done(null);
    };
  });
}

// ---- Top actions ----------------------------------------------------------
$('new-note-btn').onclick = async () => {
  if (!categories.length) { await ensureFirstCategory(); }
  const res = await modal({
    title: 'New note',
    withSelect: true,
    options: categories.map((c) => ({ value: c, label: prettify(c) })),
    placeholder: 'Note title',
  });
  if (!res || !res.text) return;
  const id = await window.api.createNote(res.select, res.text);
  await refresh();
  openNote(id);
};

$('new-cat-btn').onclick = async () => {
  const res = await modal({ title: 'New category', placeholder: 'e.g. Travel Journal' });
  if (!res || !res.text) return;
  await window.api.createCategory(res.text);
  await refresh();
};

async function ensureFirstCategory() {
  await window.api.createCategory('notes');
  await refresh();
}

$('delete-note-btn').onclick = async () => {
  if (!currentId) return;
  const res = await modal({
    title: 'Move this note to Trash? (recoverable from vault/.trash) — type "yes"',
    placeholder: 'yes',
  });
  if (!res || res.text.toLowerCase() !== 'yes') return;
  await window.api.deleteNote(currentId);
  currentId = null;
  editor.value = '';
  noteTitle.textContent = 'No note selected';
  noteCat.textContent = '';
  await refresh();
};

// ---- Photo attachments (M2) -----------------------------------------------
const MAX_IMG_WARN_BYTES = 20 * 1024 * 1024; // warn at 20 MB

async function heicToJpeg(file) {
  // Chromium on macOS supports HEIC natively via createImageBitmap
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await new Promise((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', 0.92));
    return blob.arrayBuffer();
  } catch {
    // Fall back to nativeImage in main process
    const raw = await file.arrayBuffer();
    return window.api.convertHeic(raw);
  }
}

async function insertAttachment(file) {
  if (!currentId) return;
  const note = notes.find(n => n.id === currentId);
  if (!note) return;

  if (file.size > MAX_IMG_WARN_BYTES) {
    saveState.textContent = `warning: large image (${(file.size / 1024 / 1024).toFixed(1)} MB), importing…`;
  } else {
    saveState.textContent = 'importing image…';
  }

  const isHEIC = /\.heic$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif';

  let data, mimeType, filename;
  if (isHEIC) {
    const converted = await heicToJpeg(file);
    if (!converted) { saveState.textContent = 'error: could not convert HEIC'; return; }
    data = converted;
    mimeType = 'image/jpeg';
    filename = file.name.replace(/\.heic$/i, '.jpg');
  } else {
    data = await file.arrayBuffer();
    mimeType = file.type || 'image/png';
    filename = file.name || 'image.png';
  }

  const savedName = await window.api.saveAttachment(note.category, data, filename, mimeType);

  // Insert ![[filename]] at caret
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const after = editor.value.slice(pos);
  const embed = `![[${savedName}]]`;
  editor.value = before + embed + after;
  const newPos = pos + embed.length;
  editor.setSelectionRange(newPos, newPos);
  editor.focus();

  // Mark dirty and save
  if (note) note.content = editor.value;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 500);
  saveState.textContent = `image attached: ${savedName}`;
}

// Paste: intercept image paste, let text paste fall through
editor.addEventListener('paste', async (e) => {
  if (!currentId) return;
  const items = Array.from(e.clipboardData?.items || []);
  const imageItem = items.find(item => item.type.startsWith('image/'));
  if (!imageItem) return;
  e.preventDefault();
  const file = imageItem.getAsFile();
  if (file) await insertAttachment(file);
});

// Drag-drop image files onto the editor
editor.addEventListener('dragover', (e) => {
  const hasImage = Array.from(e.dataTransfer?.items || [])
    .some(i => i.kind === 'file' && (i.type.startsWith('image/') || i.type === ''));
  if (hasImage) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    editor.classList.add('drag-over');
  }
});
editor.addEventListener('dragleave', () => editor.classList.remove('drag-over'));
editor.addEventListener('drop', async (e) => {
  editor.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer?.files || [])
    .filter(f => f.type.startsWith('image/') || /\.heic$/i.test(f.name));
  if (!files.length) return;
  e.preventDefault();
  e.stopPropagation();
  for (const file of files) await insertAttachment(file);
});

// ---- Backup ---------------------------------------------------------------
$('backup-btn').onclick = async () => {
  const btn = $('backup-btn');
  const status = $('backup-status');
  btn.disabled = true;
  status.textContent = 'backing up…';
  const result = await window.api.backup();
  btn.disabled = false;
  if (result.ok) {
    const snap = result.snapshot.split('/').pop();
    status.textContent = `✓ ${result.vaultFiles} files · ${snap}`;
    status.style.color = '#9ece6a';
  } else {
    status.textContent = `✗ ${result.error}`;
    status.style.color = '#f7768e';
  }
};

// ---- Init -----------------------------------------------------------------
window.addEventListener('resize', () => {
  if (graph) graph.resize();
  if (moodChart) moodChart.resize();
});

(async function init() {
  graph = new GraphView($('graph-canvas'), (id) => openNote(id));
  moodChart = new MoodChart($('mood-canvas'), $('mood-tooltip'), (id) => openNote(id));
  await refresh();
  const first = notes[0];
  if (first) openNote(first.id);
  const vp = await window.api.vaultPath();
  $('vault-path').textContent = vp;
  $('vault-path').title = vp;
})();

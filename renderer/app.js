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
  refreshTagList();
  if (graph) updateGraph();
}

// ---- Tags (FR-F) ------------------------------------------------------------
// Body-derived only — never written to frontmatter (§F.4). Korean+English
// word chars; "#word" mid-line is a tag, "# " (with a space) is a heading —
// the heading regex in markdownToHtml already requires that space, so no
// special-casing is needed here.
const TAG_RE = /#([A-Za-z0-9가-힣_][A-Za-z0-9가-힣_-]*)/g;

function extractTags(content) {
  const stripped = content.replace(/```[\s\S]*?```/g, ''); // ignore tags inside code fences
  const tags = new Set();
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(stripped))) tags.add(m[1]);
  return [...tags];
}

function refreshTagList() {
  const counts = new Map();
  for (const n of notes) {
    for (const t of extractTags(n.content)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const box = $('tags-list');
  if (!sorted.length) {
    box.innerHTML = '<span class="tags-empty">no tags yet</span>';
    return;
  }
  box.innerHTML = sorted
    .map(([t, c]) => `<span class="tag-chip-sidebar" data-tag="${escHtml(t)}">#${escHtml(t)} <span class="tag-count">${c}</span></span>`)
    .join('');
  for (const el of box.querySelectorAll('.tag-chip-sidebar')) {
    el.addEventListener('click', () => searchForTag(el.dataset.tag));
  }
}

// Clicking a tag (in the sidebar list or the preview) runs a search that
// matches tags only, reusing FR-A's search (F.2/F.3).
function searchForTag(tag) {
  $('search-input').value = '#' + tag;
  setSearchQuery('#' + tag);
}

function renderTree() {
  if (searchQuery) { renderSearchResults(searchQuery); return; }
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

// ---- Search (FR-A) ---------------------------------------------------------
let searchQuery = '';
let searchTimer = null;

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Builds a one-line snippet around the first matched term, HTML-escaped with
// <mark> highlights (escape happens before highlighting so query text can
// never inject markup).
function buildSnippet(content, terms) {
  const plain = content.replace(/^#\s+.+$/m, '').trim().replace(/\s+/g, ' ');
  const lower = plain.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) idx = 0;
  const start = Math.max(0, idx - 30);
  const end = Math.min(plain.length, idx + 70);
  let snippet = plain.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < plain.length) snippet += '…';
  let esc = escHtml(snippet);
  for (const t of terms) {
    if (!t) continue;
    esc = esc.replace(new RegExp('(' + escRe(t) + ')', 'ig'), '<mark>$1</mark>');
  }
  return esc;
}

// In-memory search over the loaded notes array (A.4 — no index, no libs).
// Multiple space-separated terms AND together; matches title/body/keywords/
// theme/subtheme/category, case-insensitive, Korean+English safe (plain
// substring matching needs no word-boundary regex for Hangul).
function searchNotes(query) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const n of notes) {
    const titleL = n.title.toLowerCase();
    const bodyL = n.content.toLowerCase();
    const kwL = (n.keywords || []).join(' ').toLowerCase();
    const themeL = (n.theme || '').toLowerCase();
    const subthemeL = (n.subtheme || '').toLowerCase();
    const catL = (n.category || '').toLowerCase();
    const tagsL = extractTags(n.content).map((t) => t.toLowerCase());
    const haystack = `${titleL} ${bodyL} ${kwL} ${themeL} ${subthemeL} ${catL}`;

    // A "#tag" term (F.2) matches tags only, not the general haystack.
    const matchesTerm = (t) => (t.startsWith('#') && t.length > 1)
      ? tagsL.includes(t.slice(1))
      : haystack.includes(t);
    if (!terms.every(matchesTerm)) continue;

    // best-first: title match > keyword/tag match > body match
    let score = 1;
    if (terms.some((t) => !t.startsWith('#') && kwL.includes(t))) score = 2;
    if (terms.some((t) => t.startsWith('#') && tagsL.includes(t.slice(1)))) score = 2;
    if (terms.some((t) => !t.startsWith('#') && titleL.includes(t))) score = 3;
    results.push({ note: n, score, snippet: buildSnippet(n.content, terms) });
  }
  results.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
  return results;
}

function renderSearchResults(query) {
  tree.innerHTML = '';
  const results = searchNotes(query);
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'No matches';
    tree.appendChild(empty);
    return;
  }
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'search-result-item' + (r.note.id === currentId ? ' active' : '');
    const color = colorFor(r.note.category);
    row.innerHTML =
      `<div class="sr-top"><span class="sr-title">${escHtml(r.note.title)}</span>` +
      `<span class="sr-cat" style="background:${color}22;color:${color}">${escHtml(prettify(r.note.category))}</span></div>` +
      `<div class="sr-snippet">${r.snippet}</div>`;
    row.onclick = () => openNote(r.note.id);
    tree.appendChild(row);
  }
}

function setSearchQuery(q) {
  searchQuery = q;
  renderTree();
}

$('search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setSearchQuery($('search-input').value.trim()), 150);
});
$('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('search-input').value = '';
    clearTimeout(searchTimer);
    setSearchQuery('');
    $('search-input').blur();
  }
});

// ---- Quick switcher (FR-B, Cmd+O / Cmd+P) ----------------------------------
let qsMatches = [];
let qsIndex = 0;

function openQuickSwitcher() {
  $('quick-switcher').classList.remove('hidden');
  $('qs-input').value = '';
  qsMatches = recentNotesForQs();
  qsIndex = 0;
  renderQsResults();
  setTimeout(() => $('qs-input').focus(), 20);
}
function closeQuickSwitcher() {
  $('quick-switcher').classList.add('hidden');
}
function recentNotesForQs() {
  return [...notes]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 10)
    .map((n) => ({ note: n }));
}
function computeQsMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return recentNotesForQs();
  const matches = notes
    .filter((n) => n.title.toLowerCase().includes(q))
    .slice(0, 10)
    .map((n) => ({ note: n }));
  if (matches.length) return matches;
  return [{ create: true, title: query.trim() }];
}
function renderQsResults() {
  const box = $('qs-results');
  box.innerHTML = '';
  qsMatches.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'qs-item' + (i === qsIndex ? ' sel' : '') + (m.create ? ' create' : '');
    if (m.create) {
      el.innerHTML = `+ Create “${escHtml(m.title)}”`;
    } else {
      el.innerHTML = `<span>${escHtml(m.note.title)}</span><span class="qs-cat">${escHtml(prettify(m.note.category))}</span>`;
    }
    el.onmousedown = (e) => { e.preventDefault(); chooseQs(i); };
    box.appendChild(el);
  });
}
async function chooseQs(i) {
  const m = qsMatches[i];
  if (!m) return;
  if (m.create) {
    const note = notes.find((n) => n.id === currentId);
    const cat = note ? note.category : (categories[0] || 'notes');
    const id = await window.api.createNote(cat, m.title);
    await refresh();
    closeQuickSwitcher();
    openNote(id);
    return;
  }
  closeQuickSwitcher();
  openNote(m.note.id);
}
$('qs-input').addEventListener('input', () => {
  qsMatches = computeQsMatches($('qs-input').value);
  qsIndex = 0;
  renderQsResults();
});
$('qs-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (qsMatches.length) { qsIndex = (qsIndex + 1) % qsMatches.length; renderQsResults(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (qsMatches.length) { qsIndex = (qsIndex - 1 + qsMatches.length) % qsMatches.length; renderQsResults(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    chooseQs(qsIndex);
  } else if (e.key === 'Escape') {
    closeQuickSwitcher();
  }
});
$('qs-scrim').addEventListener('click', closeQuickSwitcher);

document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && (e.key === 'o' || e.key === 'O' || e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    openQuickSwitcher();
  }
});

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
  renderPreview();
  refreshMentions();
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
  renderPreview();
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
  dirty = false;
  if (res && res.ambiguous) {
    saveState.textContent = 'saved ✓ · rename ambiguous, links not updated';
  } else if (res && res.linksUpdated) {
    saveState.textContent = `saved ✓ · ${res.linksUpdated} link${res.linksUpdated === 1 ? '' : 's'} updated`;
  } else {
    saveState.textContent = 'saved ✓';
  }
  if (res && res.linksUpdated) {
    // other notes' bodies changed on disk (link rewrite) — reload before
    // re-rendering anything derived from note content
    await refresh();
  } else {
    renderTree();
    refreshThemeList();
    refreshTagList();
    if (graph) updateGraph();
  }
  refreshMentions();
  renderPreview();
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
  if (target) { openNote(target.id); return; }
  // Unresolved wikilink — offer the same create flow as a ghost graph node (FR-E.3).
  createFromUnresolvedLink(title);
}

// Prompts (reusing the existing new-note modal) to create a note for a title
// that some [[link]] points at but doesn't exist yet. `defaultCategory`
// overrides the current note's category (used by ghost-node clicks in the
// graph, where "current note" may not be the linking note).
async function createFromUnresolvedLink(title, defaultCategory) {
  if (!categories.length) await ensureFirstCategory();
  const currentNote = notes.find((n) => n.id === currentId);
  const defaultCat = defaultCategory || (currentNote ? currentNote.category : (categories[0] || 'notes'));
  const res = await modal({
    title: `Create note “${title}”?`,
    withSelect: true,
    options: categories.map((c) => ({ value: c, label: prettify(c) })),
    placeholder: 'Note title',
    initialText: title,
    initialSelect: defaultCat,
  });
  if (!res || !res.text) return;
  const id = await window.api.createNote(res.select || defaultCat, res.text);
  await refresh();
  openNote(id);
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

  // 1) [[wiki-links]] — cross-category allowed; these are first-class edges.
  // Links whose target doesn't exist become "ghost" nodes (FR-E) instead of
  // being silently dropped, so the graph shows where the vault has gaps.
  const ghostNodes = new Map(); // lowercased title -> ghost node
  for (const n of notes) {
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(n.content))) {
      const rawTitle = m[1].trim();
      const key = rawTitle.toLowerCase();
      const target = byKey.get(key);
      if (target) {
        if (target.id !== n.id) addEdge(n.id, target.id, 'link', []);
        continue;
      }
      let ghost = ghostNodes.get(key);
      if (!ghost) {
        ghost = { id: 'ghost:' + key, title: rawTitle, category: n.category, isGhost: true, theme: '', subtheme: '', year: 'undated' };
        ghostNodes.set(key, ghost);
      }
      addEdge(n.id, ghost.id, 'link', []);
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
  const ghosts = [...ghostNodes.values()];
  return { nodes: [...nodes, ...ghosts], edges: [...edgeMap.values()], ghosts };
}

let ghostIndex = new Map(); // ghost node id -> ghost node (for click-to-create, FR-E.2)

function updateGraph() {
  const { nodes, edges, ghosts } = buildGraphData();
  ghostIndex = new Map(ghosts.map((g) => [g.id, g]));
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
    `<span class="legend-dot" style="background:transparent;border:1.5px dashed #7a82a8"></span>` +
    `ghost (unresolved link, click to create)</div>` +
    '<div class="legend-row">' +
    `<label style="display:flex;align-items:center;gap:6px;cursor:pointer">` +
    `<input type="checkbox" id="kw-bridge-toggle"${showKeywordBridges ? ' checked' : ''}>` +
    `<span style="width:18px;border-top:2px dashed #bb9af7;display:inline-block"></span>keyword bridges (≥2 shared)</label></div>` +
    '<div class="legend-row" style="margin-top:4px">' +
    `<button id="mode-2d-btn" style="font-size:11px;padding:2px 8px">${graph && graph.is2D ? '3D mode' : '2D mode'}</button></div>`;

  const toggle = document.getElementById('kw-bridge-toggle');
  if (toggle) toggle.addEventListener('change', () => { showKeywordBridges = toggle.checked; updateGraph(); });

  const modeBtn = document.getElementById('mode-2d-btn');
  if (modeBtn) {
    modeBtn.addEventListener('click', () => {
      graph.toggle2D(!graph.is2D);
      modeBtn.textContent = graph.is2D ? '3D mode' : '2D mode';
    });
  }
}

// ---- Backlinks & unlinked mentions (FR-D) ----------------------------------
// Spans of [[...]] / ![[...]] in a body, used to keep unlinked-mention
// matching from firing inside an existing link/embed.
function linkSpansOf(content) {
  const spans = [];
  const re = /!?\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(content))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

// First plain-text (non-bracketed) occurrence of `term` in `content`, or -1.
function firstPlainOccurrence(content, term) {
  if (!term) return -1;
  const spans = linkSpansOf(content);
  const re = new RegExp(escRe(term), 'ig');
  let m;
  while ((m = re.exec(content))) {
    if (!spans.some(([s, e]) => m.index >= s && m.index < e)) return m.index;
  }
  return -1;
}

function lineAround(content, idx) {
  const before = content.slice(0, idx);
  const lineStart = before.lastIndexOf('\n') + 1;
  const nlIdx = content.indexOf('\n', idx);
  const lineEnd = nlIdx === -1 ? content.length : nlIdx;
  return content.slice(lineStart, lineEnd).trim();
}

// Lines in note `n`'s body containing a real [[title]] link (not ![[embed]]).
function linkedLinesIn(n, title) {
  const target = title.trim().toLowerCase();
  const hits = [];
  for (const line of n.content.split('\n')) {
    const re = /(!?)\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(line))) {
      if (m[1] === '!') continue;
      if (m[2].trim().toLowerCase() === target) { hits.push(line.trim()); break; }
    }
  }
  return hits;
}

function toggleMentions(kind) {
  const listEl = $(kind + '-mentions-list');
  const arrowEl = $(kind + '-mentions-arrow');
  const collapsed = listEl.classList.toggle('collapsed');
  arrowEl.textContent = collapsed ? '▸' : '▾';
}
$('linked-mentions-head').addEventListener('click', () => toggleMentions('linked'));
$('unlinked-mentions-head').addEventListener('click', () => toggleMentions('unlinked'));

function renderMentions(note) {
  const linkedList = $('linked-mentions-list');
  const unlinkedList = $('unlinked-mentions-list');
  if (!note) {
    linkedList.innerHTML = '';
    unlinkedList.innerHTML = '';
    $('linked-count').textContent = '0';
    $('unlinked-count').textContent = '0';
    return;
  }

  const linked = [];
  const unlinked = [];
  for (const n of notes) {
    if (n.id === note.id) continue;
    const lines = linkedLinesIn(n, note.title);
    if (lines.length) linked.push({ note: n, line: lines[0] });
    const idx = firstPlainOccurrence(n.content, note.title);
    if (idx !== -1) unlinked.push({ note: n, snippet: lineAround(n.content, idx) });
  }

  $('linked-count').textContent = linked.length;
  $('unlinked-count').textContent = unlinked.length;

  linkedList.innerHTML = '';
  if (!linked.length) {
    linkedList.innerHTML = '<div class="mention-empty">No notes link here yet.</div>';
  } else {
    for (const { note: n, line } of linked) {
      const row = document.createElement('div');
      row.className = 'mention-row';
      row.innerHTML =
        `<span class="mention-title">${escHtml(n.title)}</span>` +
        `<span class="mention-cat">${escHtml(prettify(n.category))}</span>` +
        `<span class="mention-snippet">${escHtml(line)}</span>`;
      row.onclick = () => openNote(n.id);
      linkedList.appendChild(row);
    }
  }

  unlinkedList.innerHTML = '';
  if (!unlinked.length) {
    unlinkedList.innerHTML = '<div class="mention-empty">No unlinked mentions found.</div>';
  } else {
    for (const { note: n, snippet } of unlinked) {
      const row = document.createElement('div');
      row.className = 'mention-row';
      row.innerHTML =
        `<span class="mention-title">${escHtml(n.title)}</span>` +
        `<span class="mention-cat">${escHtml(prettify(n.category))}</span>` +
        `<span class="mention-snippet">${escHtml(snippet)}</span>`;
      const btn = document.createElement('button');
      btn.className = 'mention-link-btn';
      btn.textContent = 'Link';
      btn.onclick = async (e) => {
        e.stopPropagation();
        await linkUnlinkedMention(note.title, n.id);
      };
      row.appendChild(btn);
      row.onclick = () => openNote(n.id);
      unlinkedList.appendChild(row);
    }
  }
}

function refreshMentions() {
  renderMentions(currentId ? notes.find((n) => n.id === currentId) : null);
}

// Wraps the first plain-text occurrence of `targetTitle` in note `noteId`
// into a [[link]] and saves that note (D.2).
async function linkUnlinkedMention(targetTitle, noteId) {
  const n = notes.find((x) => x.id === noteId);
  if (!n) return;
  const idx = firstPlainOccurrence(n.content, targetTitle);
  if (idx === -1) return;
  const newContent = n.content.slice(0, idx) + `[[${targetTitle}]]` + n.content.slice(idx + targetTitle.length);
  n.content = newContent;
  const res = await window.api.saveNote(n.id, newContent, n.theme, n.subtheme, n.date);
  n.keywords = (res && res.keywords) || [];
  if (currentId === n.id) { editor.value = newContent; renderPreview(); }
  await refresh();
  refreshMentions();
  if (graph) updateGraph();
}

// ---- Tabs -----------------------------------------------------------------
function switchTab(which) {
  for (const t of ['editor', 'graph', 'posts']) {
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
  if (which === 'posts') renderPosts(notes, categories);
}

$('tab-editor').onclick = () => switchTab('editor');
$('tab-graph').onclick = () => switchTab('graph');
$('tab-posts').onclick = () => switchTab('posts');

// ---- Modal helper ---------------------------------------------------------
function modal({ title, withSelect, options, placeholder, initialText, initialSelect }) {
  return new Promise((resolve) => {
    const m = $('modal');
    $('modal-title').textContent = title;
    const input = $('modal-input');
    const select = $('modal-select');
    input.value = initialText || '';
    input.placeholder = placeholder || '';
    if (withSelect) {
      select.classList.remove('hidden');
      select.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
      if (initialSelect && options.some((o) => o.value === initialSelect)) select.value = initialSelect;
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

// ---- Markdown preview (M3 split pane) -------------------------------------
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function linkResolves(title) {
  const t = title.trim().toLowerCase();
  return notes.some((n) => n.title.toLowerCase() === t || n.slug.toLowerCase() === t);
}

// Wraps #tag tokens in a span, skipping any that fall inside a [[...]] or
// ![[...]] span so a wiki-link title containing "#" is never corrupted by an
// injected tag <span> before the link/embed regexes run.
function tagTokenize(escapedLine) {
  const spans = [];
  const linkRe = /!?\[\[([^\]]+)\]\]/g;
  let lm;
  while ((lm = linkRe.exec(escapedLine))) spans.push([lm.index, lm.index + lm[0].length]);
  const within = (idx) => spans.some(([s, e]) => idx >= s && idx < e);
  TAG_RE.lastIndex = 0;
  return escapedLine.replace(TAG_RE, (m, t, offset) =>
    within(offset) ? m : `<span class="tag-token" data-tag="${t}">#${t}</span>`);
}

function renderInline(raw) {
  let s = escHtml(raw);
  s = tagTokenize(s);
  s = s.replace(/!\[\[([^\]]+)\]\]/g, (_, f) =>
    `<img src="vault:///${f}" class="md-img" alt="${f}">`);
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, t) => {
    const cls = linkResolves(t) ? 'wikilink' : 'wikilink wikilink-ghost';
    return `<span class="${cls}" data-title="${t}">${t}</span>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return s;
}

function markdownToHtml(text) {
  const lines = text.split('\n');
  const out = [];
  let listType = null;
  let inQuote = false;
  let inCode = false;
  let codeLines = [];
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code block (```lang ... ```) — content is escaped only, never
    // run through renderInline, so nothing inside can be misread as markdown
    if (/^```/.test(line.trim())) {
      if (!inCode) { closeList(); closeQuote(); inCode = true; codeLines = []; }
      else { inCode = false; out.push(`<pre><code>${escHtml(codeLines.join('\n'))}</code></pre>`); }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const hm = line.match(/^(#{1,6}) (.+)/);
    if (hm) {
      closeList(); closeQuote();
      const lv = hm[1].length;
      out.push(`<h${lv}>${renderInline(hm[2])}</h${lv}>`);
      continue;
    }
    if (/^-{3,}\s*$/.test(line.trim())) {
      closeList(); closeQuote();
      out.push('<hr>');
      continue;
    }
    const qm = line.match(/^>\s?(.*)$/);
    if (qm) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`<p>${renderInline(qm[1])}</p>`);
      continue;
    }
    closeQuote();
    const tm = line.match(/^[-*] \[([ xX])\] (.*)$/);
    if (tm) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      const checked = tm[1].toLowerCase() === 'x';
      out.push(`<li class="task-item${checked ? ' done' : ''}"><input type="checkbox" class="task-checkbox" data-line="${i}"${checked ? ' checked' : ''}>${renderInline(tm[2])}</li>`);
      continue;
    }
    if (/^[-*] /.test(line)) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${renderInline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    if (line.trim() === '') {
      closeList();
      out.push('<div class="md-spacer"></div>');
      continue;
    }
    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
  }
  if (inCode) out.push(`<pre><code>${escHtml(codeLines.join('\n'))}</code></pre>`); // unterminated fence
  closeList();
  closeQuote();
  return out.join('');
}

// Toggles a `- [ ]` / `- [x]` task line at `lineIdx` in the current note's
// source and saves (G.1 — manual diary state, not habit tracking).
function toggleTaskCheckbox(lineIdx) {
  if (!currentId) return;
  const lines = editor.value.split('\n');
  const line = lines[lineIdx];
  if (line === undefined) return;
  const m = line.match(/^([-*] \[)([ xX])(\].*)$/);
  if (!m) return;
  const newChar = m[2].toLowerCase() === 'x' ? ' ' : 'x';
  lines[lineIdx] = m[1] + newChar + m[3];
  editor.value = lines.join('\n');
  const note = notes.find((n) => n.id === currentId);
  if (note) note.content = editor.value;
  dirty = true;
  clearTimeout(saveTimer);
  saveCurrent();
}

function renderPreview() {
  const pane = $('preview');
  if (!pane) return;
  pane.innerHTML = markdownToHtml(editor.value);
  for (const el of pane.querySelectorAll('.wikilink')) {
    el.addEventListener('click', () => followLink(el.dataset.title));
  }
  for (const el of pane.querySelectorAll('.tag-token')) {
    el.addEventListener('click', () => searchForTag(el.dataset.tag));
  }
  for (const el of pane.querySelectorAll('.task-checkbox')) {
    el.addEventListener('click', () => toggleTaskCheckbox(parseInt(el.dataset.line, 10)));
  }
}

// Draggable split handle
(function initSplitHandle() {
  const handle = $('split-handle');
  const editorPane = $('editor-pane');
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = editorPane.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const split = $('editor-split');
    const totalW = split.getBoundingClientRect().width;
    const newW = Math.max(180, Math.min(totalW - 200, startW + (e.clientX - startX)));
    editorPane.style.flex = 'none';
    editorPane.style.width = newW + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

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
});

(async function init() {
  graph = new GraphView($('graph-canvas'), (id) => {
    if (typeof id === 'string' && id.startsWith('ghost:')) {
      const g = ghostIndex.get(id);
      if (g) createFromUnresolvedLink(g.title, g.category);
      return;
    }
    openNote(id);
  });
  await refresh();
  const first = notes[0];
  if (first) openNote(first.id);
  const vp = await window.api.vaultPath();
  $('vault-path').textContent = vp;
  $('vault-path').title = vp;
})();

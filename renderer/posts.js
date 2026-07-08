// ---- Posts view (FR-8) — Instagram-style diary feed + photo grid ----------
// Depends on: escHtml, markdownToHtml, renderInline, followLink, colorFor,
//             prettify (all defined in app.js, loaded before this file).

// ---- State ----------------------------------------------------------------
let postsActiveCategories = new Set(); // empty = show all
let postsMode = null; // 'feed' | 'grid' — null until first render (auto-detect)

// Lightbox state for grid prev/next navigation
let lbPhotos = [];     // array of vault:// URLs for the active entry
let lbIndex = 0;       // current photo index in lbPhotos
let lbNoteId = null;   // id of the note whose lightbox is open

// ---- Helpers --------------------------------------------------------------

function imageEmbeds(content) {
  const re = /!\[\[([^\]]+)\]\]/g;
  const imgs = [];
  let m;
  while ((m = re.exec(content)) !== null) imgs.push(m[1]);
  return imgs;
}

function formatKoDate(dateStr) {
  if (!dateStr) return '';
  const d = String(dateStr);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    try {
      const date = new Date(d + 'T12:00:00');
      return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric',
      }).format(date);
    } catch { return d; }
  }
  if (/^\d{4}$/.test(d)) return `${d}년`;
  return d;
}

function noteDate(note) {
  const d = String(note.date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if (/^\d{4}$/.test(d)) return d + '-01-01';
  return '0000-01-01';
}

function catBanner(color) {
  if (color.startsWith('#')) {
    return `linear-gradient(135deg, ${color}dd 0%, ${color}55 100%)`;
  }
  return `linear-gradient(135deg, ${color} 0%, #1a1b26 100%)`;
}

function dayOfDate(dateStr) {
  const d = String(dateStr || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.slice(8);
  if (/^\d{4}$/.test(d)) return d;
  return '';
}

function monthYearOfDate(dateStr) {
  const d = String(dateStr || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    try {
      const date = new Date(d + 'T12:00:00');
      return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' }).format(date);
    } catch { return d.slice(0, 7); }
  }
  return d;
}

// Alpha-blend a hex color at given opacity for placeholder tile backgrounds
function hexAlpha(color, alpha) {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color; // hsl() — return as-is (alpha on hsl is fine with modern CSS)
}

// ---- Feed mode card -------------------------------------------------------

function buildCard(note) {
  const imgs = imageEmbeds(note.content);
  const [cover, ...extraImgs] = imgs;

  const card = document.createElement('article');
  card.className = 'post-card';
  card.dataset.id = note.id;

  // Cover photo or gradient banner
  if (cover) {
    const img = document.createElement('img');
    img.className = 'post-cover-img';
    img.loading = 'lazy';
    img.alt = cover;
    img.src = `vault:///${cover}`;
    img.addEventListener('click', () => openLightbox(imgs.map(f => `vault:///${f}`), 0, note.id));
    card.appendChild(img);
  } else {
    const banner = document.createElement('div');
    banner.className = 'post-banner';
    banner.style.background = catBanner(colorFor(note.category));
    banner.innerHTML =
      `<span class="banner-day">${escHtml(dayOfDate(note.date))}</span>` +
      `<span class="banner-month">${escHtml(monthYearOfDate(note.date))}</span>`;
    card.appendChild(banner);
  }

  // Card body wrapper
  const wrap = document.createElement('div');
  wrap.className = 'post-body-wrap';

  // Header: category chip + date
  const header = document.createElement('div');
  header.className = 'post-header';
  const color = colorFor(note.category);
  header.innerHTML =
    `<span class="post-cat-chip"><span class="cat-dot" style="background:${color}"></span>${escHtml(prettify(note.category))}</span>` +
    `<span class="post-date">${escHtml(formatKoDate(note.date))}</span>`;
  wrap.appendChild(header);

  // Title (clickable → open in editor)
  const title = document.createElement('h2');
  title.className = 'post-title';
  title.textContent = note.title;
  title.addEventListener('click', () => followLink(note.title));
  wrap.appendChild(title);

  // Body — strip first heading + cover embed to avoid duplication
  let bodyText = note.content;
  bodyText = bodyText.replace(/^#\s+.+\n?/m, '');
  if (cover) bodyText = bodyText.replace(`![[${cover}]]`, '');
  bodyText = bodyText.trim();

  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'post-body';
  bodyDiv.innerHTML = markdownToHtml(bodyText);
  // wire wikilinks
  for (const el of bodyDiv.querySelectorAll('.wikilink')) {
    el.addEventListener('click', () => followLink(el.dataset.title));
  }
  wrap.appendChild(bodyDiv);

  // 더 보기 / 접기 toggle
  const moreBtn = document.createElement('button');
  moreBtn.className = 'post-more-btn';
  moreBtn.textContent = '더 보기';
  moreBtn.addEventListener('click', () => {
    const expanded = bodyDiv.classList.toggle('expanded');
    moreBtn.textContent = expanded ? '접기' : '더 보기';
  });
  wrap.appendChild(moreBtn);

  // Extra photos thumbnail row
  if (extraImgs.length) {
    const thumbs = document.createElement('div');
    thumbs.className = 'post-thumbs';
    for (let i = 0; i < extraImgs.length; i++) {
      const img = extraImgs[i];
      const t = document.createElement('img');
      t.className = 'post-thumb';
      t.loading = 'lazy';
      t.alt = img;
      t.src = `vault:///${img}`;
      // index+1 because index 0 is the cover
      t.addEventListener('click', () => openLightbox(imgs.map(f => `vault:///${f}`), i + 1, note.id));
      thumbs.appendChild(t);
    }
    wrap.appendChild(thumbs);
  }

  // Hashtag footer
  const tags = [];
  if (note.theme) tags.push(note.theme);
  if (note.subtheme) tags.push(note.subtheme);
  for (const kw of (note.keywords || [])) {
    if (!tags.includes(kw)) tags.push(kw);
  }
  if (tags.length) {
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'post-tags';
    tagsDiv.innerHTML = tags.map((t) => `<span class="post-tag">#${escHtml(t)}</span>`).join('');
    wrap.appendChild(tagsDiv);
  }

  card.appendChild(wrap);
  return card;
}

// ---- Grid mode tile -------------------------------------------------------

function buildGridTile(note) {
  const imgs = imageEmbeds(note.content);
  if (!imgs.length) return null; // grid only shows photo entries

  const cover = imgs[0];
  const color = colorFor(note.category);

  const tile = document.createElement('div');
  tile.className = 'grid-tile';
  tile.style.backgroundColor = hexAlpha(color, 0.15);
  tile.dataset.id = note.id;

  // Cover image (lazy, object-fit cover via CSS)
  const img = document.createElement('img');
  img.className = 'grid-tile-img';
  img.loading = 'lazy';
  img.alt = note.title;
  img.src = `vault:///${cover}`;
  tile.appendChild(img);

  // Multi-photo badge ⧉
  if (imgs.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'grid-multi-badge';
    badge.textContent = '⧉';
    tile.appendChild(badge);
  }

  // Hover overlay: shows date
  const overlay = document.createElement('div');
  overlay.className = 'grid-tile-overlay';
  overlay.innerHTML = `<span class="grid-tile-date">${escHtml(formatKoDate(note.date))}</span>`;
  tile.appendChild(overlay);

  // Click → lightbox starting at cover, cycling through all photos
  tile.addEventListener('click', () => {
    openLightbox(imgs.map(f => `vault:///${f}`), 0, note.id);
  });

  return tile;
}

// ---- Render entry points --------------------------------------------------

function renderPosts(notes, categories) {
  const filterBar = document.getElementById('posts-filter-bar');
  const feed = document.getElementById('posts-feed');
  if (!filterBar || !feed) return;

  // Auto-detect default mode on first render
  if (postsMode === null) {
    const withPhotos = notes.filter(n => imageEmbeds(n.content).length > 0).length;
    postsMode = (withPhotos / Math.max(notes.length, 1)) > 0.5 ? 'grid' : 'feed';
  }

  // Build filter chips + mode switch
  buildFilterBar(notes, categories);
  updateModeButtons();
  buildContent(notes);
}

function buildFilterBar(notes, categories) {
  const filterBar = document.getElementById('posts-filter-bar');
  filterBar.innerHTML = '';
  for (const cat of categories) {
    const chip = document.createElement('button');
    chip.className = 'posts-chip' + (postsActiveCategories.has(cat) ? ' active' : '');
    const color = colorFor(cat);
    if (postsActiveCategories.has(cat)) chip.style.background = color;
    chip.innerHTML = `<span class="cat-dot" style="background:${color}"></span>${escHtml(prettify(cat))}`;
    chip.addEventListener('click', () => {
      if (postsActiveCategories.has(cat)) {
        postsActiveCategories.delete(cat);
        chip.classList.remove('active');
        chip.style.background = '';
      } else {
        postsActiveCategories.add(cat);
        chip.classList.add('active');
        chip.style.background = color;
      }
      // Re-render content only (filter bar stays)
      buildContent(_lastNotes);
    });
    filterBar.appendChild(chip);
  }
}

// Keep a reference to the last notes array for filter clicks
let _lastNotes = [];

function buildContent(notes) {
  _lastNotes = notes;
  if (postsMode === 'grid') {
    buildGrid(notes);
  } else {
    buildFeed(notes);
  }
  // Show/hide the right container
  document.getElementById('posts-feed').classList.toggle('hidden', postsMode === 'grid');
  document.getElementById('posts-grid').classList.toggle('hidden', postsMode !== 'grid');
}

function buildFeed(notes) {
  const feed = document.getElementById('posts-feed');
  feed.innerHTML = '';

  const visible = postsActiveCategories.size === 0
    ? notes
    : notes.filter((n) => postsActiveCategories.has(n.category));

  // Newest first (undated sink to bottom)
  const sorted = [...visible].sort((a, b) => noteDate(b).localeCompare(noteDate(a)));

  for (const note of sorted) {
    feed.appendChild(buildCard(note));
  }

  if (!sorted.length) {
    feed.innerHTML = '<p style="color:var(--text-dim);text-align:center;margin-top:60px">No entries yet.</p>';
  }
}

function buildGrid(notes) {
  const grid = document.getElementById('posts-grid');
  grid.innerHTML = '';

  const visible = postsActiveCategories.size === 0
    ? notes
    : notes.filter((n) => postsActiveCategories.has(n.category));

  const sorted = [...visible].sort((a, b) => noteDate(b).localeCompare(noteDate(a)));

  const withPhotos = sorted.filter(n => imageEmbeds(n.content).length > 0);
  const withoutPhotos = sorted.filter(n => imageEmbeds(n.content).length === 0);

  // Count note for text-only entries
  if (withoutPhotos.length > 0) {
    const note = document.createElement('p');
    note.className = 'grid-text-note';
    note.innerHTML = `글만 있는 일기 <strong>${withoutPhotos.length}개</strong>는 ` +
      `<button class="grid-switch-feed-btn">피드에서 보기</button>`;
    note.querySelector('.grid-switch-feed-btn').addEventListener('click', () => {
      switchPostsMode('feed');
    });
    grid.appendChild(note);
  }

  if (!withPhotos.length) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--text-dim);text-align:center;margin-top:60px;width:100%';
    empty.textContent = '사진이 있는 일기가 없습니다. 피드에서 보기를 눌러 모든 일기를 확인하세요.';
    grid.appendChild(empty);
    return;
  }

  const tileWrap = document.createElement('div');
  tileWrap.className = 'grid-tiles';
  for (const note of withPhotos) {
    const tile = buildGridTile(note);
    if (tile) tileWrap.appendChild(tile);
  }
  grid.appendChild(tileWrap);
}

// ---- Mode switching -------------------------------------------------------

function switchPostsMode(mode) {
  postsMode = mode;
  updateModeButtons();
  buildContent(_lastNotes);
}

function updateModeButtons() {
  const feedBtn = document.getElementById('posts-mode-feed');
  const gridBtn = document.getElementById('posts-mode-grid');
  if (!feedBtn || !gridBtn) return;
  feedBtn.classList.toggle('active', postsMode === 'feed');
  gridBtn.classList.toggle('active', postsMode === 'grid');
}

// Wire mode buttons (called once after DOM ready, here in DOMContentLoaded scope)
document.getElementById('posts-mode-feed').addEventListener('click', () => switchPostsMode('feed'));
document.getElementById('posts-mode-grid').addEventListener('click', () => switchPostsMode('grid'));

// ---- Lightbox -------------------------------------------------------------
// Supports both feed (single-image) and grid (multi-image with prev/next)

function openLightbox(photos, startIndex, noteId) {
  lbPhotos = photos || [];
  lbIndex = startIndex || 0;
  lbNoteId = noteId || null;

  const lb = document.getElementById('lightbox');
  lb.classList.remove('hidden');
  setLightboxPhoto(lbIndex);

  // Show/hide nav arrows
  const showNav = lbPhotos.length > 1;
  document.getElementById('lightbox-prev').classList.toggle('hidden', !showNav);
  document.getElementById('lightbox-next').classList.toggle('hidden', !showNav);
}

function setLightboxPhoto(index) {
  lbIndex = (index + lbPhotos.length) % lbPhotos.length;
  document.getElementById('lightbox-img').src = lbPhotos[lbIndex];
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  lb.classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
  lbPhotos = [];
  lbNoteId = null;
}

document.getElementById('lightbox-scrim').addEventListener('click', closeLightbox);

document.getElementById('lightbox-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  setLightboxPhoto(lbIndex - 1);
});

document.getElementById('lightbox-next').addEventListener('click', (e) => {
  e.stopPropagation();
  setLightboxPhoto(lbIndex + 1);
});

document.getElementById('lightbox-open-note').addEventListener('click', (e) => {
  e.stopPropagation();
  if (lbNoteId) {
    closeLightbox();
    // followLink works by title, so use openNote directly via the notes array
    // app.js exposes openNote globally on window
    if (typeof openNote === 'function') openNote(lbNoteId);
  }
});

document.addEventListener('keydown', (e) => {
  const lb = document.getElementById('lightbox');
  if (lb.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') setLightboxPhoto(lbIndex - 1);
  else if (e.key === 'ArrowRight') setLightboxPhoto(lbIndex + 1);
});

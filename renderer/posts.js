// ---- Posts view (FR-8) — Instagram-style diary feed ----------------------
// Depends on: escHtml, markdownToHtml, renderInline, followLink, colorFor,
//             prettify (all defined in app.js, loaded before this file).

let postsActiveCategories = new Set(); // empty = show all

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
    img.addEventListener('click', () => openLightbox(`vault:///${cover}`));
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
    for (const img of extraImgs) {
      const t = document.createElement('img');
      t.className = 'post-thumb';
      t.loading = 'lazy';
      t.alt = img;
      t.src = `vault:///${img}`;
      t.addEventListener('click', () => openLightbox(`vault:///${img}`));
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

function renderPosts(notes, categories) {
  const filterBar = document.getElementById('posts-filter-bar');
  const feed = document.getElementById('posts-feed');
  if (!filterBar || !feed) return;

  // Build filter chips
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
      buildFeed(notes);
    });
    filterBar.appendChild(chip);
  }

  buildFeed(notes);
}

function buildFeed(notes) {
  const feed = document.getElementById('posts-feed');
  feed.innerHTML = '';

  const visible = postsActiveCategories.size === 0
    ? notes
    : notes.filter((n) => postsActiveCategories.has(n.category));

  // Newest first
  const sorted = [...visible].sort((a, b) => {
    const da = noteDate(a), db = noteDate(b);
    return db.localeCompare(da);
  });

  for (const note of sorted) {
    feed.appendChild(buildCard(note));
  }

  if (!sorted.length) {
    feed.innerHTML = '<p style="color:var(--text-dim);text-align:center;margin-top:60px">No entries yet.</p>';
  }
}

// Lightbox
function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.src = src;
  lb.classList.remove('hidden');
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  lb.classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
}

document.getElementById('lightbox-scrim').addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

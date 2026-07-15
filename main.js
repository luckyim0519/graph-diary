const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// vault:// is a read-only image-serving scheme — must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { secure: true, standard: true } },
]);

// The "vault" is just a folder of Markdown files on disk.
// Each top-level subfolder is a category (e.g. villain-diary, daily-diary).
const VAULT = path.join(app.getPath('userData'), 'vault');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#1a1b26',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---- Vault helpers --------------------------------------------------------

function slugify(name) {
  // Keep Hangul so Korean note titles become real filenames (not "untitled").
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

// ---- Keywords (local, offline) -------------------------------------------

const STOPWORDS_EN = new Set((
  'the a an and or but if then else when while of to in on at by for with about ' +
  'as into like through after over between out against during without before under ' +
  'around among is am are was were be been being do does did doing have has had ' +
  'having this that these those it its it\'s i me my myself we our ours you your ' +
  'yours he him his she her hers they them their what which who whom whose where why ' +
  'how all any both each few more most other some such no nor not only own same so ' +
  'than too very can will just dont don\'t should now also got get really thing ' +
  'today yesterday tomorrow day went again still even back here there one two from ' +
  'up down out off see saw feel felt want wanted make made'
).split(/\s+/));

// Common Korean function words to ignore (pronouns, adverbs, light verbs, etc.)
const STOPWORDS_KO = new Set((
  '나 너 우리 저희 저 그 이 것 거 수 등 점 때 더 좀 또 또한 그리고 그러나 하지만 그래서 ' +
  '그런데 그래도 그러면 그리하여 정말 진짜 그냥 너무 아주 매우 많이 조금 약간 거의 정도 ' +
  '오늘 어제 내일 지금 아까 나중 다시 계속 항상 가끔 보통 그것 이것 저것 무엇 누구 어디 ' +
  '언제 어떻게 모든 이런 저런 그런 어떤 동안 통해 위해 대해 만약 만큼 때문 거기 여기 저기 ' +
  '하다 되다 있다 없다 이다 같다 보다 오다 가다 말 일 게 안 못 잘 좀 데 줄 분 번 개'
).split(/\s+/));

// Korean particles (조사) stripped from the end of a token. Longest first.
const KO_PARTICLES = [
  '으로서', '으로써', '에서는', '에게서', '이라고', '이라는', '으로', '로서', '로써',
  '에서', '에게', '께서', '한테', '라고', '라는', '에는', '에도', '만큼', '처럼',
  '부터', '까지', '조차', '마저', '밖에', '보다', '마다', '이나', '이며', '이라',
  '은', '는', '이', '가', '을', '를', '과', '와', '도', '만', '의', '로', '에',
  '께', '뿐', '나', '며', '고',
].sort((a, b) => b.length - a.length);

function stripKoParticle(tok) {
  for (const p of KO_PARTICLES) {
    if (tok.endsWith(p)) {
      const stem = tok.slice(0, -p.length);
      if (stem.length >= 2) return stem; // keep 2-char nouns intact, avoid over-stripping
    }
  }
  return tok;
}

// Tokenize mixed Korean/English text into meaningful keyword candidates.
function tokenize(text) {
  const out = [];
  const re = /[가-힣]+|[A-Za-z][A-Za-z']+/g;
  let m;
  while ((m = re.exec(text))) {
    let t = m[0];
    if (/[가-힣]/.test(t)) {
      t = stripKoParticle(t);
      if (t.length >= 2 && !STOPWORDS_KO.has(t)) out.push(t);
    } else {
      t = t.toLowerCase();
      if (t.length >= 3 && !STOPWORDS_EN.has(t)) out.push(t);
    }
  }
  return out;
}

// Pulls the most notable words out of a note's body for the header.
// Works for Korean and English; title words count double.
function extractKeywords(body, max = 5) {
  // Strip ![[embed]] syntax so image filenames don't pollute keywords (FR-2.6)
  const stripped = body.replace(/!\[\[[^\]]*\]\]/g, '');
  const titleSet = new Set(tokenize(extractTitle(body) || ''));
  const freq = new Map();
  for (const w of tokenize(stripped)) {
    freq.set(w, (freq.get(w) || 0) + (titleSet.has(w) ? 2 : 1));
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

// ---- Frontmatter ----------------------------------------------------------
// Header fields: date, theme, subtheme, keywords.
// Old fields mood: / emotions: are parsed and silently ignored (FR-7.2 tolerance).

function field(block, name) {
  // [ \t]* (not \s*) so an empty value doesn't swallow the next line
  const m = block.match(new RegExp('^' + name + ':[ \\t]*(.*)$', 'm'));
  return m ? m[1].trim() : '';
}
function listField(block, name) {
  const v = field(block, name);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// Returns { meta, body }. meta = { date, theme, subtheme, keywords }
// Old mood:/emotions: fields in the block are tolerated (parse-and-ignore).
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const block = m[1];
  const meta = {
    date: field(block, 'date'),
    theme: field(block, 'theme'),
    subtheme: field(block, 'subtheme'),
    keywords: listField(block, 'keywords'),
  };
  return { meta, body: raw.slice(m[0].length).replace(/^\n+/, '') };
}

// Writes the header (only non-empty fields) followed by the body.
function composeFile(body, meta = {}) {
  const clean = body.replace(/^\s+/, '');
  const lines = ['---'];
  if (meta.date) lines.push(`date: ${meta.date}`);
  lines.push(`theme: ${meta.theme || ''}`);
  lines.push(`subtheme: ${meta.subtheme || ''}`);
  lines.push(`keywords: ${(meta.keywords || []).join(', ')}`);
  lines.push('---', '', clean);
  return lines.join('\n');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}


async function ensureVault() {
  await fsp.mkdir(VAULT, { recursive: true });
  const entries = await fsp.readdir(VAULT, { withFileTypes: true });
  const hasCategory = entries.some((e) => e.isDirectory());
  if (!hasCategory) {
    // Seed a couple of starter categories with example, linked notes.
    await seedVault();
  }
}

async function seedVault() {
  const seed = {
    'daily-diary': {
      'morning-pages.md': {
        theme: 'morning', date: '2026-06-15',
        body: '# Morning Pages\n\nWoke up thinking about the nemesis again. Today I want to feel calm and hopeful.\n\nSee also [[Gratitude List]].\n',
      },
      'gratitude-list.md': {
        theme: 'morning', date: '2026-06-22',
        body: '# Gratitude List\n\n- Coffee, so grateful\n- The quiet before everyone wakes, so peaceful\n- My ongoing feud, also a nemesis problem\n',
      },
    },
    'villain-diary': {
      'nemesis.md': {
        theme: 'rivalry', date: '2026-06-12',
        body: '# Nemesis\n\nEvery hero needs one. The plan must account for them. I feel anxious about it.\n\nMaster plan tracked in [[Master Plan]].\n',
      },
      'master-plan.md': {
        theme: 'canada', subtheme: 'PEY', date: '2026-06-20',
        body: '# Master Plan\n\nStep 1. Acquire more coffee.\nStep 2. Refine the plan.\nStep 3. Profit, defeat the nemesis. I feel proud and hopeful.\n',
      },
      'toronto-op.md': {
        theme: 'canada', subtheme: 'toronto', date: '2026-06-25',
        body: '# Toronto Op\n\nScout the towers. Coffee supply is plentiful here. A calm, good day.\n',
      },
    },
  };
  for (const [cat, files] of Object.entries(seed)) {
    const dir = path.join(VAULT, cat);
    await fsp.mkdir(dir, { recursive: true });
    for (const [file, { body, theme, subtheme, date }] of Object.entries(files)) {
      const content = composeFile(body, {
        theme, subtheme, date: date || today(), keywords: extractKeywords(body),
      });
      await fsp.writeFile(path.join(dir, file), content, 'utf8');
    }
  }
}

// Returns every note: { id, category, slug, title, content, keywords }
// `content` is the body only (the keyword header is parsed out separately).
async function listNotes() {
  await ensureVault();
  const notes = [];
  const cats = await fsp.readdir(VAULT, { withFileTypes: true });
  for (const cat of cats) {
    if (!cat.isDirectory() || cat.name.startsWith('.') || cat.name.startsWith('_')) continue; // skip .trash, _assets etc.
    const dir = path.join(VAULT, cat.name);
    const files = await fsp.readdir(dir, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.md')) continue;
      const full = path.join(dir, f.name);
      const raw = await fsp.readFile(full, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const slug = f.name.replace(/\.md$/, '');
      let date = meta.date;
      if (!date) {
        const st = await fsp.stat(full); // fall back to file modified time
        date = st.mtime.toISOString().slice(0, 10);
      }
      notes.push({
        id: `${cat.name}/${f.name}`,
        category: cat.name,
        slug,
        title: extractTitle(body) || slug,
        content: body,
        keywords: meta.keywords || [],
        theme: meta.theme || '',
        subtheme: meta.subtheme || '',
        date,
      });
    }
  }
  return notes;
}

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// ---- IPC ------------------------------------------------------------------

ipcMain.handle('notes:list', () => listNotes());

ipcMain.handle('categories:list', async () => {
  await ensureVault();
  const cats = await fsp.readdir(VAULT, { withFileTypes: true });
  return cats
    .filter((c) => c.isDirectory() && !c.name.startsWith('.') && !c.name.startsWith('_'))
    .map((c) => c.name);
});

// Reads the existing header of a note (to preserve date across saves).
function existingMeta(full) {
  try {
    return parseFrontmatter(fs.readFileSync(full, 'utf8')).meta;
  } catch {
    return {};
  }
}

// Saving re-derives keywords from the body. The entry's date is preserved.
ipcMain.handle('note:save', async (_e, { id, content, theme, subtheme, date }) => {
  const full = path.join(VAULT, id);
  const prev = existingMeta(full);
  const keywords = extractKeywords(content);
  await fsp.writeFile(full, composeFile(content, {
    date: date || prev.date || today(), theme: theme || '', subtheme: subtheme || '',
    keywords,
  }), 'utf8');
  return { keywords };
});

// Synchronous save — used when the window is closing, so the write completes
// before the app exits and nothing typed is ever lost.
ipcMain.on('note:save-sync', (e, { id, content, theme, subtheme, date }) => {
  try {
    const full = path.join(VAULT, id);
    const prev = existingMeta(full);
    const keywords = extractKeywords(content);
    fs.writeFileSync(full, composeFile(content, {
      date: date || prev.date || today(), theme: theme || '', subtheme: subtheme || '',
      keywords,
    }), 'utf8');
    e.returnValue = { ok: true };
  } catch (err) {
    e.returnValue = { ok: false, error: String(err) };
  }
});

ipcMain.handle('note:create', async (_e, { category, title, theme, subtheme }) => {
  const dir = path.join(VAULT, category);
  await fsp.mkdir(dir, { recursive: true });
  const slug = slugify(title);
  const file = `${slug}.md`;
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    const body = `# ${title}\n\n`;
    await fsp.writeFile(full, composeFile(body, {
      date: today(), theme: theme || '', subtheme: subtheme || '',
      keywords: extractKeywords(body),
    }), 'utf8');
  }
  return `${category}/${file}`;
});

// Move a note to a different category (drag & drop). This renames the file;
// content/header are preserved. Never overwrites an existing note in the
// target — collisions get a numeric suffix instead.
ipcMain.handle('note:move', async (_e, { id, toCategory }) => {
  const fromCategory = path.dirname(id);
  if (fromCategory === toCategory) return id;
  const src = path.join(VAULT, id);
  const base = path.basename(id);
  const destDir = path.join(VAULT, toCategory);
  await fsp.mkdir(destDir, { recursive: true });
  let name = base;
  let dest = path.join(destDir, name);
  let i = 2;
  while (fs.existsSync(dest)) {
    name = base.replace(/\.md$/, `-${i}.md`);
    dest = path.join(destDir, name);
    i++;
  }
  await fsp.rename(src, dest);
  return `${toCategory}/${name}`;
});

// Reclassify a note via drag & drop onto a theme / sub-theme: optionally move
// it to another category (file rename, collision-safe) AND set its theme /
// subtheme header. Body, keywords, date are all preserved.
ipcMain.handle('note:reclassify', async (_e, { id, category, theme, subtheme }) => {
  const fromCategory = path.dirname(id);
  let dest = path.join(VAULT, id);
  let finalId = id;
  if (category && category !== fromCategory) {
    const base = path.basename(id);
    const destDir = path.join(VAULT, category);
    await fsp.mkdir(destDir, { recursive: true });
    let name = base, d = path.join(destDir, name), i = 2;
    while (fs.existsSync(d)) {
      name = base.replace(/\.md$/, `-${i}.md`); d = path.join(destDir, name); i++;
    }
    await fsp.rename(path.join(VAULT, id), d);
    dest = d; finalId = `${category}/${name}`;
  }
  const { meta, body } = parseFrontmatter(fs.readFileSync(dest, 'utf8'));
  if (theme !== undefined) meta.theme = theme;
  if (subtheme !== undefined) meta.subtheme = subtheme;
  fs.writeFileSync(dest, composeFile(body, meta), 'utf8');
  return finalId;
});

// Soft-delete: move the note into vault/.trash/<category>/ with a timestamp
// instead of erasing it, so it can always be recovered.
ipcMain.handle('note:delete', async (_e, { id }) => {
  const src = path.join(VAULT, id);
  const cat = path.dirname(id);
  const base = path.basename(id);
  const trashDir = path.join(VAULT, '.trash', cat);
  await fsp.mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fsp.rename(src, path.join(trashDir, `${stamp}__${base}`));
  return true;
});

ipcMain.handle('category:create', async (_e, { name }) => {
  const slug = slugify(name);
  await fsp.mkdir(path.join(VAULT, slug), { recursive: true });
  return slug;
});

ipcMain.handle('vault:path', () => VAULT);

// ---- Attachments (FR-2) --------------------------------------------------

const ALLOWED_IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MIME_FOR_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

ipcMain.handle('attachment:save', async (_e, { category, data, filename, mimeType }) => {
  const assetsDir = path.join(VAULT, category, '_assets');
  await fsp.mkdir(assetsDir, { recursive: true });

  const extFromMime = mimeType === 'image/jpeg' ? '.jpg'
    : mimeType === 'image/png' ? '.png'
    : mimeType === 'image/gif' ? '.gif'
    : mimeType === 'image/webp' ? '.webp' : null;
  const extFromName = path.extname(filename || '').toLowerCase();
  const ext = extFromMime || (ALLOWED_IMG_EXTS.has(extFromName) ? extFromName : '.jpg');

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '') + '-' +
    now.toISOString().slice(11, 19).replace(/:/g, '');
  const base = path.basename(filename || 'image', path.extname(filename || '')).slice(0, 40);
  const slug = slugify(base).slice(0, 30) || 'image';
  let name = `${stamp}-${slug}${ext}`;
  let i = 2;
  while (fs.existsSync(path.join(assetsDir, name))) {
    name = `${stamp}-${slug}-${i}${ext}`; i++;
  }
  await fsp.writeFile(path.join(assetsDir, name), Buffer.from(data));
  return name;
});

// HEIC → JPEG fallback via nativeImage (used when canvas/createImageBitmap fails)
ipcMain.handle('attachment:convert-heic', async (_e, { data }) => {
  const img = nativeImage.createFromBuffer(Buffer.from(data));
  if (img.isEmpty()) return null;
  const jpeg = img.toJPEG(92);
  return jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength);
});

// ---- Backup (FR-5) -------------------------------------------------------

const BACKUP_DRIVE = '/Volumes/Seagate';
const BACKUP_ROOT = path.join(BACKUP_DRIVE, 'graph-diary-backups');
const REPO_ROOT = __dirname;

function countFilesSync(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) count += countFilesSync(path.join(dir, e.name));
      else count++;
    }
  } catch { /* skip unreadable dirs */ }
  return count;
}

async function runBackup() {
  if (!fs.existsSync(BACKUP_DRIVE)) {
    return { ok: false, error: 'drive not connected' };
  }
  if (!fs.existsSync(VAULT)) {
    return { ok: false, error: 'vault not found' };
  }

  const stamp = new Date().toISOString()
    .slice(0, 19).replace('T', '-').replace(/:/g, '');
  const snapshotDir = path.join(BACKUP_ROOT, stamp);
  const vaultDest = path.join(snapshotDir, 'vault');
  const repoDest = path.join(snapshotDir, 'repo');

  await fsp.mkdir(vaultDest, { recursive: true });
  await fsp.mkdir(repoDest, { recursive: true });

  await fsp.cp(VAULT, vaultDest, { recursive: true });

  await fsp.cp(REPO_ROOT, repoDest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO_ROOT, src);
      return !rel.startsWith('node_modules') && path.basename(src) !== '.DS_Store';
    },
  });

  const srcCount = countFilesSync(VAULT);
  const dstCount = countFilesSync(vaultDest);
  if (srcCount !== dstCount) {
    return {
      ok: false,
      error: `verification failed: source ${srcCount} files, backup ${dstCount}`,
      snapshot: snapshotDir,
    };
  }

  return { ok: true, snapshot: snapshotDir, vaultFiles: srcCount };
}

ipcMain.handle('backup:run', () => runBackup());

// ---- Life Assistant (assistant/ module) ------------------------------------
// The assistant is a standalone Node module; the app passes its VAULT so both
// always agree on where the diary lives.

const assistant = require('./assistant');
const assistantCfg = () => assistant.loadConfig({ vault: VAULT });

ipcMain.handle('assistant:new-journal', async () => {
  const r = assistant.newJournal(assistantCfg());
  return r; // { id, created }
});

ipcMain.handle('assistant:new-logs', async () => {
  return assistant.newHabitLogs(assistantCfg()); // [{ id, created }]
});

// kind: 'week' | 'month'; period defaults to the current one.
ipcMain.handle('assistant:review', async (_e, { kind, period } = {}) => {
  const cfg = assistantCfg();
  const todayStr = new Date().toLocaleDateString('sv'); // local YYYY-MM-DD
  const p = period ||
    (kind === 'month' ? todayStr.slice(0, 7) : assistant.isoweek.weekString(todayStr));
  try {
    const res = await assistant.generateReview(kind, p, cfg);
    return { ok: true, period: p, path: res.path, warnings: res.warnings };
  } catch (err) {
    // err.message may include a validation report but never prompt contents.
    return { ok: false, period: p, error: String(err.message || err) };
  }
});

// Habit UI (PRD-habit-ui): append-only logging + heatmap range data.
ipcMain.handle('habit:log', async (_e, { habit, entry }) => {
  try {
    return { ok: true, ...assistant.logHabit(assistantCfg(), habit, entry) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('habit:data', async (_e, { habit, fromDate, toDate }) => {
  const cfg = assistantCfg();
  return {
    ...assistant.habitRange(cfg, habit, fromDate, toDate),
    exerciseTypes: cfg.exerciseTypes,
  };
});

// ---- App lifecycle --------------------------------------------------------

app.whenReady().then(async () => {
  // vault:// protocol — serves images from <VAULT>/<cat>/_assets/ read-only.
  // URL format: vault:///<filename>  → searches all categories' _assets dirs.
  protocol.handle('vault', async (request) => {
    const url = new URL(request.url);
    // With standard:true, Chromium normalizes vault:///file.png → vault://file.png/
    // so the filename ends up in hostname instead of pathname. Handle both forms:
    //   vault://local/file.png  → pathname=/file.png  (preferred, used by M3 renderer)
    //   vault:///file.png       → hostname=file.png, pathname=/  (fallback)
    let filename = url.pathname.replace(/^\/+/, '');
    if (!filename && url.hostname && path.extname(url.hostname)) {
      filename = url.hostname;
    }
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return new Response('Forbidden', { status: 403 });
    }
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_IMG_EXTS.has(ext)) return new Response('Forbidden', { status: 403 });

    // Search all category _assets/ dirs for the file (§5.1 resolution rule)
    let filePath = null;
    try {
      const cats = await fsp.readdir(VAULT, { withFileTypes: true });
      for (const cat of cats) {
        if (!cat.isDirectory() || cat.name.startsWith('.') || cat.name.startsWith('_')) continue;
        const candidate = path.join(VAULT, cat.name, '_assets', filename);
        if (fs.existsSync(candidate)) { filePath = candidate; break; }
      }
    } catch { /* vault not ready yet */ }

    if (!filePath) return new Response('Not Found', { status: 404 });

    // Double-check the resolved path stays inside VAULT/_assets
    const canonical = path.resolve(filePath);
    const vaultRoot = path.resolve(VAULT);
    if (!canonical.startsWith(vaultRoot + path.sep) || !canonical.includes('_assets')) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await fsp.readFile(canonical);
      return new Response(data, { headers: { 'Content-Type': MIME_FOR_EXT[ext] || 'image/jpeg' } });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });

  await ensureVault();
  console.error('[graph-diary] vault ready at', VAULT);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

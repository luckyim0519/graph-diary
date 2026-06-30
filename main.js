const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

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
  const titleSet = new Set(tokenize(extractTitle(body) || ''));
  const freq = new Map();
  for (const w of tokenize(body)) {
    freq.set(w, (freq.get(w) || 0) + (titleSet.has(w) ? 2 : 1));
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

// ---- Frontmatter ----------------------------------------------------------
// Header fields: date, theme, subtheme, mood, emotions, keywords.

function field(block, name) {
  // [ \t]* (not \s*) so an empty value doesn't swallow the next line
  const m = block.match(new RegExp('^' + name + ':[ \\t]*(.*)$', 'm'));
  return m ? m[1].trim() : '';
}
function listField(block, name) {
  const v = field(block, name);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// Returns { meta, body }. meta = { date, theme, subtheme, mood, emotions, keywords }
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const block = m[1];
  const moodRaw = field(block, 'mood');
  const meta = {
    date: field(block, 'date'),
    theme: field(block, 'theme'),
    subtheme: field(block, 'subtheme'),
    mood: moodRaw === '' ? null : Number(moodRaw),
    emotions: listField(block, 'emotions'),
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
  if (meta.mood !== undefined && meta.mood !== null && meta.mood !== '') {
    lines.push(`mood: ${meta.mood}`);
  }
  if (meta.emotions && meta.emotions.length) {
    lines.push(`emotions: ${meta.emotions.join(', ')}`);
  }
  lines.push(`keywords: ${(meta.keywords || []).join(', ')}`);
  lines.push('---', '', clean);
  return lines.join('\n');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Mood analysis (local) ------------------------------------------------
// Tries a local Ollama model first; falls back to an offline lexicon so the
// feature works with no setup. Either way nothing leaves the machine.

const OLLAMA_URL = 'http://localhost:11434';
const MOOD_MODEL = process.env.GD_OLLAMA_MODEL || 'qwen2.5';

// Substring-matched sentiment cues (Korean conjugates, so match stems).
const POS_CUES = (
  'happy glad grateful thankful calm peace peaceful love loved hope hopeful ' +
  'excited joy joyful proud relaxed content satisfied better good great wonderful ' +
  '좋 행복 기쁘 기뻐 감사 고마 사랑 평화 평온 차분 설레 설렘 만족 희망 뿌듯 기대 ' +
  '신나 즐거 편안 안심 웃 다행'
).split(/\s+/);
const NEG_CUES = (
  'sad angry anger anxious anxiety afraid fear scared lonely alone tired exhausted ' +
  'hate hated regret worried worry stress stressed depressed upset hurt frustrated ' +
  'awful terrible bad worse cry crying ' +
  '슬프 슬퍼 화 분노 짜증 불안 두렵 무섭 우울 외롭 힘들 지치 지쳐 미워 싫 후회 ' +
  '걱정 스트레스 상처 눈물 울 답답 괴로 절망 부담 아프'
).split(/\s+/);

const EMOTION_CUES = {
  happy: ['happy', 'joy', 'glad', '행복', '기쁘', '기뻐', '즐거', '신나'],
  grateful: ['grateful', 'thankful', '감사', '고마', '다행'],
  calm: ['calm', 'peace', 'relaxed', '평온', '차분', '편안', '안심'],
  hopeful: ['hope', 'excited', '희망', '기대', '설레'],
  anxious: ['anxious', 'anxiety', 'worried', 'nervous', '불안', '걱정', '초조'],
  sad: ['sad', 'cry', 'depressed', 'lonely', '슬프', '슬퍼', '우울', '외롭', '눈물', '울'],
  angry: ['angry', 'anger', 'hate', 'frustrated', '화', '분노', '짜증', '미워', '싫'],
  tired: ['tired', 'exhausted', 'stress', '힘들', '지치', '지쳐', '스트레스', '답답'],
};

function lexiconMood(text) {
  const t = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const w of POS_CUES) if (w && t.includes(w)) pos++;
  for (const w of NEG_CUES) if (w && t.includes(w)) neg++;
  const total = pos + neg;
  // map to -5..+5
  const score = total === 0 ? 0 : Math.round(((pos - neg) / total) * 5);
  const emotions = [];
  for (const [emo, cues] of Object.entries(EMOTION_CUES)) {
    if (cues.some((c) => t.includes(c))) emotions.push(emo);
  }
  return { mood: score, emotions: emotions.slice(0, 3), engine: 'lexicon' };
}

async function ollamaMood(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const prompt =
      'You analyze a personal diary entry (Korean or English). Respond ONLY with ' +
      'JSON: {"mood": <integer -5..5>, "emotions": [up to 3 lowercase english tags]}. ' +
      'mood -5 = very negative, 0 = neutral, 5 = very positive.\n\nEntry:\n' + text;
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MOOD_MODEL, prompt, stream: false, format: 'json' }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('ollama ' + res.status);
    const data = await res.json();
    const parsed = JSON.parse(data.response);
    let mood = Math.round(Number(parsed.mood));
    if (Number.isNaN(mood)) throw new Error('bad mood');
    mood = Math.max(-5, Math.min(5, mood));
    const emotions = Array.isArray(parsed.emotions)
      ? parsed.emotions.map((e) => String(e).toLowerCase().trim()).filter(Boolean).slice(0, 3)
      : [];
    return { mood, emotions, engine: 'ollama' };
  } finally {
    clearTimeout(timer);
  }
}

let ollamaOk = null; // cache reachability per session
async function ollamaReachable() {
  if (ollamaOk !== null) return ollamaOk;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1500);
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: c.signal });
    clearTimeout(t);
    ollamaOk = r.ok;
  } catch {
    ollamaOk = false;
  }
  return ollamaOk;
}

async function analyzeMood(text) {
  if (!text || !text.trim()) return { mood: 0, emotions: [], engine: 'empty' };
  if (await ollamaReachable()) {
    try {
      return await ollamaMood(text);
    } catch {
      ollamaOk = null; // re-check next time
    }
  }
  return lexiconMood(text);
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
    if (!cat.isDirectory()) continue;
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
        mood: meta.mood,
        emotions: meta.emotions || [],
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
  return cats.filter((c) => c.isDirectory()).map((c) => c.name);
});

// Reads the existing header of a note (to preserve date across saves).
function existingMeta(full) {
  try {
    return parseFrontmatter(fs.readFileSync(full, 'utf8')).meta;
  } catch {
    return {};
  }
}

// Saving re-derives keywords from the body and clears the cached mood (the body
// changed, so it must be re-analyzed). The entry's date is preserved.
ipcMain.handle('note:save', async (_e, { id, content, theme, subtheme }) => {
  const full = path.join(VAULT, id);
  const prev = existingMeta(full);
  const keywords = extractKeywords(content);
  await fsp.writeFile(full, composeFile(content, {
    date: prev.date || today(), theme: theme || '', subtheme: subtheme || '',
    keywords, mood: null, emotions: [],
  }), 'utf8');
  return { keywords };
});

// Synchronous save — used when the window is closing, so the write completes
// before the app exits and nothing typed is ever lost.
ipcMain.on('note:save-sync', (e, { id, content, theme, subtheme }) => {
  try {
    const full = path.join(VAULT, id);
    const prev = existingMeta(full);
    const keywords = extractKeywords(content);
    fs.writeFileSync(full, composeFile(content, {
      date: prev.date || today(), theme: theme || '', subtheme: subtheme || '',
      keywords, mood: null, emotions: [],
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

// ---- Mood IPC -------------------------------------------------------------

ipcMain.handle('ollama:status', async () => ({
  reachable: await ollamaReachable(), model: MOOD_MODEL,
}));

// Analyze every entry missing a mood (or all of them if force=true), write the
// result into each header, and return [{ id, mood, emotions, engine }].
ipcMain.handle('moods:analyze', async (_e, { force } = {}) => {
  ollamaOk = null; // re-check Ollama at the start of each batch
  const notes = await listNotes();
  const results = [];
  for (const n of notes) {
    if (!force && n.mood !== null && n.mood !== undefined) {
      results.push({ id: n.id, mood: n.mood, emotions: n.emotions, engine: 'cached' });
      continue;
    }
    const { mood, emotions, engine } = await analyzeMood(n.content);
    const full = path.join(VAULT, n.id);
    const prev = existingMeta(full);
    fs.writeFileSync(full, composeFile(n.content, {
      ...prev, keywords: prev.keywords || n.keywords, mood, emotions,
    }), 'utf8');
    results.push({ id: n.id, mood, emotions, engine });
  }
  return results;
});

ipcMain.handle('note:delete', async (_e, { id }) => {
  await fsp.unlink(path.join(VAULT, id));
  return true;
});

ipcMain.handle('category:create', async (_e, { name }) => {
  const slug = slugify(name);
  await fsp.mkdir(path.join(VAULT, slug), { recursive: true });
  return slug;
});

ipcMain.handle('vault:path', () => VAULT);

// ---- App lifecycle --------------------------------------------------------

app.whenReady().then(async () => {
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

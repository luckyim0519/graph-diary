# PRD — Posts View: delete Mood, add Instagram-style diary feed

- **Status:** ✅ Approved — ready for implementation
- **Author:** Claude (manager mode), for luckyim
- **Date:** 2026-07-07
- **Parent doc:** `docs/PRD-graph-and-photos.md` (FR-7 + FR-8 spun out here after the M2 commit shipped only the photo pipeline). Read the parent's §8 decisions and §9 handoff checklist — they all apply.
- **Baseline:** commit `f165016` (`M3: live split-pane markdown preview`). All file/line references below are against this commit.

---

## 1. Why

The Mood analysis feature (Ollama/lexicon sentiment scoring + mood-over-time chart) is being **removed** by user decision. Its tab slot is taken by a **Posts view**: every diary entry rendered as a pretty Instagram-style card, so re-reading the diary feels like scrolling a private feed. This replaces mood analytics as the app's "reflection" surface.

Everything stays local and private: images through the existing `vault://` protocol, no external fonts/CDNs, CSP unchanged except what already exists.

## 2. Part A — Delete the Mood feature (FR-7)

### A.1 Exact removal map (as-built locations)

| File | What to remove |
|---|---|
| `renderer/mood.js` | Delete the whole file. |
| `renderer/index.html` | `#tab-mood` button (line ~36); the whole `#mood-view` section (`#mood-bar`, `#mood-engine`, `#mood-refresh`, `#mood-chart-wrap`, `#mood-canvas`, `#mood-tooltip`, `#mood-summary`, lines ~91–101); the `<script src="mood.js">` tag. |
| `renderer/app.js` | The entire "Mood / emotional arc" section (`moodChart`, `moodLoaded`, `openMood`, `runMoodAnalysis`, `openMoodStatus`, `renderMood`, `renderMoodSummary`, `$('mood-refresh').onclick`, ~lines 517–598); `'mood'` entries in `switchTab`'s tab array and the `if (which === 'mood') openMood()` branch; `$('tab-mood').onclick`; `moodChart` construction in `init()` and `moodChart.resize()` in the window resize handler; the `note.mood = null; moodLoaded = false;` lines in `saveCurrent`. |
| `preload.js` | `ollamaStatus` and `analyzeMoods` bridges (lines 19–20). |
| `main.js` | IPC handlers `ollama:status` (~line 434) and `moods:analyze` (~line 440); the whole "Mood analysis (local)" block: `OLLAMA_URL`, `MOOD_MODEL`, `POS_CUES`, `NEG_CUES`, `EMOTION_CUES`, `lexiconMood`, `ollamaMood`, `ollamaOk`, `ollamaReachable`, `analyzeMood` (~lines 161–263). |
| `renderer/style.css` | All `mood-*` rules. |

### A.2 What must NOT be removed

- **`extractKeywords` / `tokenize` / stopword tables in `main.js`** — keywords power `[[link]]` autocomplete, the graph's keyword-bridge toggle, and this PRD's hashtags (B.4).
- **Frontmatter tolerance:** `parseFrontmatter` keeps parsing `mood:` / `emotions:` fields (parse-and-ignore is fine; dropping them from the returned meta is fine too as long as parsing never breaks). `composeFile` simply stops receiving/writing mood values — remove its `mood`/`emotions` lines only if no caller still passes them.
- **🚨 Never bulk-rewrite vault files to strip old `mood:`/`emotions:` headers.** They are harmless and disappear naturally on each note's next normal save. The vault is untouchable (AGENTS.md).

### A.3 Acceptance (Part A)

- App launches with two tabs (`✎ Editor`, `🕸 Graph`) plus the new `▦ Posts` tab from Part B; no mood UI anywhere.
- `grep -ri "mood\|ollama" main.js preload.js renderer/` returns nothing (except, possibly, old-file tolerance comments).
- A vault note whose header still contains `mood: 3` / `emotions: happy` opens, edits, and saves cleanly; after one normal save its header no longer carries those fields.
- No Ollama network probe fires on launch (nothing calls `localhost:11434`).

## 3. Part B — Posts view (FR-8)

> ### ⚠ REVISION 2 (2026-07-07, user feedback after first implementation) — grid-first, no vertical feed
>
> The user rejected the single-column vertical feed ("not one by one in vertical direction"). The Posts view is restructured as **grid + post-page overlay**, exactly like browsing an Instagram profile. This supersedes the mode structure in B.1 and the layouts in B.2/B.3.5; the card anatomy in B.3 survives as the *post page* design. B.0's design language still binds everything.
>
> **R2.1 — One surface: the grid.** The Posts tab opens directly into a photo grid that fills the pane — **6 columns at the default 1280px window** (≈6×6 tiles visible per screen), scaling down to 4 columns on narrow panes and up to 8 on very wide ones. Square tiles, 2–3px gutters, newest first. The ⊞/☰ segmented control and the vertical feed mode are **removed** (delete the feed rendering path; don't hide it).
> **R2.2 — Every entry is in the grid.** Because the grid is now the only browsing surface, text-only entries are no longer excluded: they render as the category-gradient date tiles (B.3 item 2 style, squared). This reverses B-G.3's photo-only rule and its "글만 있는 일기" link (both dropped). Photo entries keep the ⧉ multi-photo badge and hover-date overlay from B-G.4/G.5.
> **R2.3 — Click a tile → the post page.** A centered overlay (~560px wide, dark scrim behind, Esc/scrim-click closes) showing the full Instagram-style card per B.3: cover photo, category chip + ko-KR date, title, **full body** (rendered markdown, scrollable — the 6-line clamp and 더 보기 expander are dropped, they were for the feed), thumbnail row for extra photos (click → image lightbox as built), `#hashtags`, and ✎ 열기 to open the note in the editor. **‹ / › arrows (and ← → keys) step to the previous/next post** in the current grid order without closing the overlay — Instagram's post-paging behavior.
> **R2.4 — Unchanged:** category filter chips (they filter the grid), lazy loading with category-tinted placeholders, XSS discipline, offline-only `vault://` images, Korean labels.
>
> **R2 acceptance (replaces the Feed/Grid acceptance lists in B.5):**
> - Posts tab opens straight into the grid; at default window width 6 columns of square tiles fill the pane, newest first, no vertical card feed anywhere.
> - Text-only entries appear as gradient date tiles; photo entries show center-cropped covers; multi-photo entries show ⧉.
> - Clicking any tile opens the post-page overlay with the full entry (photos, full text, hashtags); ‹/› and arrow keys page through posts; Esc closes; ✎ 열기 lands in the editor on that note.
> - Category chips filter the grid live; images lazy-load with tinted placeholders; everything works offline.
> - Design conformance per B.0 unchanged (no text on real photos except the hover date overlay, no borders, quiet chrome).

### B.0 Design language — "minimal Instagram" (binding, not decorative advice)

The look is defined by three well-known references. When a styling question isn't answered by this PRD, the implementer resolves it by asking *"what would these three do?"* — in this priority order:

| Reference | What we copy from it |
|---|---|
| **Instagram** (feed post + profile grid) | The card anatomy and rhythm: full-bleed cover image, small header row above it (avatar-sized category dot + name + date), actions/metadata *below* the image, tight vertical stack of cards with even gaps; and the **profile grid**: uniform square tiles, 3 columns, hairline gutters (~2–3px), no captions on tiles, hover/press reveals a subtle overlay. |
| **VSCO** (feed) | The restraint: monochrome chrome, *no* borders around cards — separation via spacing and a barely-visible elevation change; the photo is the only saturated element on screen; UI text is small, low-contrast, and stays out of the photo's way. |
| **Medium** (article typography) | The text: one type family (system stack is fine), generous line-height (~1.6), comfortable measure (~65ch max), clear size hierarchy between title and body, *no* boxes/rules around text — whitespace does the structuring. |

Concrete rules derived from the above (these are requirements):

- **The photo is the hero.** Nothing overlaps it (no text on the image, no gradient scrims on real photos — scrims only on the no-photo fallback banner).
- **Chrome is quiet.** Category chips, dates, hashtags: small (11–12px), muted foreground color from the existing palette; color appears only in the category dot and hashtag hover.
- **One accent per card** — the category color, used in the dot and the fallback banner. Never color the title or body.
- **Whitespace over lines.** No card borders, no divider rules inside a card; 16–20px internal padding, 24–32px between cards.
- **Motion is minimal:** 150–200ms ease on hover elevation, expander, and grid-tile overlay. Nothing bounces, nothing slides in from off-screen.

### B.1 Placement & modes

New tab `▦ Posts` in the toolbar where Mood was (`#tab-posts`, `#posts-view` section). Wire it into `switchTab` (arrays become `['editor', 'graph', 'posts']`). Entering the tab (re)builds from the in-memory `notes` array — no new IPC needed; everything required (`content`, `date`, `category`, `keywords`, `theme`, `subtheme`, `title`) is already in `listNotes()` output.

The view has **two modes**, switched by a small segmented control at the top-right of the Posts toolbar (icon-only, Instagram-profile style): **⊞ Grid** (default when >50% of notes have photos, else Feed) and **☰ Feed**. Last-used mode is remembered per session. The category filter chips (B.2) apply to both modes.

### B.2 Feed

- Vertically scrolling feed of cards, **newest first** by `date` (reuse `yearOf`-style date handling; undated notes sink to the bottom).
- **Category filter chips** across the top: one chip per category, colored via the existing `colorFor(cat)`, multi-select toggle; empty selection = show all.
- **Lazy rendering:** build cards for all notes but attach `<img>` sources via `IntersectionObserver` (or `loading="lazy"` as the minimum), so a big vault with photos doesn't decode everything up front.

### B.3 Card anatomy (the "pretty" part — Instagram-like on the dark theme)

Top to bottom:

1. **Cover photo** — the note's *first* `![[image]]` embed, `src="vault:///<file>"`, edge-to-edge width, `object-fit: cover`, fixed aspect ratio (~4:3), rounded top corners.
2. **No-photo fallback** — entries without images get a banner of the same aspect ratio: soft gradient derived from the category color (e.g. `linear-gradient(135deg, color 0%, darkened 100%)`) with the day-of-month large and month/year small, so text-only entries look designed, not broken.
3. **Header row** — category chip (dot + name, category color) · date formatted `2026년 7월 7일` (ko-KR via `Intl.DateTimeFormat`; year-only dates render as `2026년`).
4. **Title** — the note's `title` (first `#` heading).
5. **Body** — rendered with the existing `markdownToHtml()` from `renderer/app.js` (strip the first `#` heading and the cover image's embed line first to avoid duplication), clamped to ~6 lines (`-webkit-line-clamp`) with a **"더 보기"** expander that un-clamps in place. `[[wikilinks]]` inside the body stay clickable (navigate via existing `followLink`).
6. **Extra photos** — if the note has more than one image embed: a small thumbnail row under the body (square thumbs, ~64px). Clicking any image (cover or thumb) opens a **lightbox** overlay (full-size image, dark scrim, close on Esc/click). *(Carousel swipe: out of scope, M4.)*
7. **Hashtag footer** — the note's `keywords` as `#키워드` chips; `theme`/`subtheme` as chips too when set.
8. **Edit affordance** — clicking the title (or a small `✎`) calls `openNote(id)` → jumps to the editor tab (which `openNote` already does via `switchTab('editor')`).

Card styling: elevated card background (`var(--bg)`-family per existing style.css tokens), 12–16px radius, soft shadow, generous padding, max-width ~560px centered in the view. Match the existing Tokyo-Night-ish palette in `style.css` — no new fonts.

### B.3.5 Grid mode — the photo diary wall (Instagram profile grid)

The second mode: the whole diary as a wall of photos, for the "photo diary" use case.

| ID | Requirement |
|---|---|
| B-G.1 | **Uniform square tiles**, CSS grid, responsive column count: 3 columns at the default window width (Instagram-style), 4–5 when the pane is wider; **2–3px gutters**, no tile borders, no captions on tiles. |
| B-G.2 | Tile image = the note's cover photo (first `![[embed]]`), `object-fit: cover`, center-cropped to square — same extraction helper as the feed. |
| B-G.3 | **Photo-less entries**: by default the grid shows *only* entries that have photos (it's a photo wall). A small count note under the toolbar — "글만 있는 일기 N개는 피드에서 보기" — links to Feed mode. *(Alternative of gradient date-tiles was considered and rejected: it dilutes the Instagram-profile look.)* |
| B-G.4 | **Multi-photo entries** occupy one tile (the cover) with the small stacked-squares badge ⧉ in the top-right corner, exactly like Instagram's multi-post indicator. |
| B-G.5 | **Hover/press**: subtle dark overlay (150ms) showing date (small, centered) — nothing else. Click opens the **lightbox** (same component as the feed) starting at that entry's cover, with prev/next arrows cycling through *that entry's* photos; a "✎ 열기" affordance in the lightbox opens the note in the editor. |
| B-G.6 | Order and filtering match the feed: newest first, category chips apply. |
| B-G.7 | **Lazy loading is mandatory here** (a grid decodes many images): `loading="lazy"` minimum, IntersectionObserver preferred; tiles get a flat placeholder background (category color at ~15% alpha) while loading, so the wall never flashes white. |

### B.4 Implementation notes

- New file `renderer/posts.js` (mirrors how `graph.js`/`mood.js` were structured) or a section in `app.js` — implementer's choice; keep dependency-free.
- Image-embed extraction: reuse the `!\[\[([^\]]+)\]\]` regex already used by `renderInline`; a small shared helper `imageEmbeds(content)` avoids drift.
- The renderer already escapes HTML before injection (`escHtml`) — keep the same XSS discipline for card fields (title, keywords are user text).
- Korean throughout: dates in ko-KR, "더 보기 / 접기" expander labels, Hangul hashtags render as-is.

### B.5 Acceptance (Part B)

**Feed mode:**
- Posts tab shows every entry as a card, newest first; filter chips narrow by category and combine.
- A note with a photo shows it as the cover; its embed line doesn't repeat inside the body text.
- A photo-less note shows the gradient date banner.
- A note with 3 photos: cover + 2 thumbnails; clicking any opens the lightbox; Esc closes it.
- Long entries clamp at ~6 lines and expand with 더 보기; `[[links]]` in the body navigate.
- Keywords appear as `#hashtags`; clicking the title opens that note in the editor.
- Feed scrolls smoothly with all vault entries; images load lazily.
- Works entirely offline; only `vault://` image requests occur.

**Grid mode:**
- Segmented ⊞/☰ control switches modes; last choice sticks for the session; filter chips affect both modes.
- Grid shows square, center-cropped tiles in 3+ responsive columns with 2–3px gutters, newest first; only photo entries appear, with the "글만 있는 일기 N개" note linking to Feed.
- A multi-photo entry shows the ⧉ badge; clicking a tile opens the lightbox and prev/next cycles through only that entry's photos; ✎ 열기 jumps to the editor.
- Hovering a tile fades in the date overlay; tiles show the category-tinted placeholder until their image loads.

**Design conformance (B.0):**
- No text or scrim ever overlays a real photo in the feed; no borders around cards; category color appears only in dots, hashtag hover, fallback banners, and grid placeholders.
- Side-by-side eyeball check against Instagram profile grid + VSCO feed screenshots: an outside observer should identify the inspiration immediately.

## 4. Delivery

- One milestone, two commits: `Posts-A: remove mood feature` then `Posts-B: Instagram-style posts feed` (A first — it frees the tab slot and deletes code B would otherwise have to dodge).
- Test against a **throwaway `userData` dir**, never the real vault (AGENTS.md). Run with `npm start`.
- Before starting, make a fresh Seagate backup if the drive is connected (`npm run backup`).

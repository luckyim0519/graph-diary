# PRD — Graph Diary v2: Link-First Graph & Photo Attachments

- **Status:** ✅ Approved — ready for implementation. All open questions resolved (§8).
- **Author:** Claude (manager mode), for luckyim
- **Date:** 2026-07-07
- **Scope:** `graph-diary` Electron app (this repo)
- **Audience:** the implementing agent. This document is self-contained; read AGENTS.md first, then this. Do not re-open decided questions — §8 records the user's final answers.

---

## 1. Background — current architecture (as-built)

| Layer | File | What it does today |
|---|---|---|
| Main process | `main.js` | Vault = `userData/vault/`, one folder per category, `.md` files with a frontmatter header (`date, theme, subtheme, mood, emotions, keywords`). Keywords auto-extracted (KR/EN tokenizer). Mood via local Ollama → lexicon fallback. IPC for list/save/create/move/reclassify/soft-delete. |
| Bridge | `preload.js` | `window.api.*` wrappers over IPC. |
| UI shell | `renderer/app.js` | Sidebar tree (year → category → theme → sub-theme), textarea editor with `[[link]]` autocomplete and cmd-click follow, debounced + sync-on-close save, drag & drop reclassify. |
| Graph | `renderer/graph.js` | Dependency-free 3D force graph. Cluster anchors nested year → category → theme → sub-theme. |
| Mood | `renderer/mood.js` | Mood-over-time canvas chart. |

**Non-negotiable constraint (AGENTS.md):** the vault is irreplaceable personal data. Every change in this PRD must be additive or migrate-in-place. No delete/re-seed, ever. Any migration step must be preceded by a timestamped `cp -R` backup.

---

## 2. Problems

### P1 — The graph is a category diagram, not a knowledge graph
`buildGraphData()` in `renderer/app.js` only creates `[[wiki-link]]` edges **when both notes share a category** (`target.category === n.category`). Cross-category edges exist only as auto-generated shared-keyword "bridges".

Consequences:
- A deliberate `[[link]]` from `daily-diary` to `travel-journal` is silently dropped — the user's strongest signal of connection is ignored.
- Keyword bridges are O(n²) noise: any two notes that both mention "커피" get an edge, whether related or not. As the vault grows to many categories and hundreds of notes, the graph converges on hairball.
- Net effect: edges ≈ "same category", which the user has correctly identified as useless. Obsidian's model is the opposite: **explicit links are the graph; everything else is decoration.**

### P2 — No photos
The user wants photos inside diary entries (a diary without photos of the day is half a diary). Today:
- The editor is a raw `<textarea>` — it can never display an image.
- `listNotes()` reads only `*.md`; any image dropped in the vault is invisible to the app.
- CSP is `default-src 'self'` — even an `<img>` pointing at the vault (which lives in `userData`, outside the renderer folder) would be blocked.

### P3 — "Villain diary" is a seed example, not the product
The vault already supports arbitrary category folders, but seeds, docs and demos are built around 2 example categories. The product assumption going forward: **many categories** (travel, study, work, people, …), each holding many notes with photos. Nothing may hard-code category names, and per-note features (photos, links) must be category-agnostic.

---

## 3. Goals

1. **G1 — Obsidian-parity graph:** `[[wiki-links]]` are first-class edges regardless of category. The graph reflects what the user linked, not where files sit.
2. **G2 — Photos in every entry:** paste or drag a photo into a note; it is stored inside the vault, embedded in the markdown, and rendered in the app.
3. **G3 — Scale to many categories:** UI, graph and storage behave sensibly at ~20 categories / ~1,000 notes / ~2,000 photos.
4. **G4 — Stay local, private, plain-files:** everything remains readable Markdown + ordinary image files on disk (openable in Obsidian itself if the user ever migrates). No cloud, no databases, no new heavyweight dependencies.

### Non-goals (this release)
- Full WYSIWYG markdown editor (bold/tables rendering while typing).
- Image editing (crop/rotate), OCR, or AI image tagging.
- Cloud sync (local portable-disk backup is now in scope — see FR-5; cloud stays out per the privacy constraint).
- Attachment nodes in the graph (photos are content, not graph citizens — for now).

---

## 4. Requirements

### FR-1: Link-first graph (Must)

| ID | Requirement |
|---|---|
| FR-1.1 | A `[[wiki-link]]` creates a **solid edge between any two notes, in any categories**. This is the primary edge type. |
| FR-1.2 | Keyword-overlap edges are **demoted to a secondary, dashed, off-by-default layer** with a toggle in the graph legend ("show keyword bridges"). When on, require ≥2 shared keywords to draw an edge (single-keyword matches are noise). |
| FR-1.3 | Unresolved links (`[[Something]]` with no matching note) render as small **ghost nodes** (hollow circles), clickable to create the note — Obsidian behavior, and a natural "write here next" prompt. *(Should, can slip to M3.)* |
| FR-1.4 | Edge direction is stored (A links to B) but drawn undirected; direction feeds the backlinks panel (FR-1.6). |
| FR-1.5 | Cluster anchoring (year → category → theme → sub-theme) is retained, but spring forces from real links must be able to pull linked notes from different categories visibly toward each other (link stiffness > cross-cluster anchor stiffness). |
| FR-1.6 | **Backlinks panel** in the editor view: "N notes link here", each row clickable. This is the Obsidian feature that makes links compound in value. *(Should.)* |
| FR-1.7 | Link resolution matches title **or slug**, case-insensitive, Korean-aware (already true in `followLink` — carry the same map into graph building; today the two code paths already share `byKey`, keep it single-source). |

**Explicitly removed:** the `target.category === n.category` filter on wiki-link edges.

### FR-2: Photo attachments (Must)

| ID | Requirement |
|---|---|
| FR-2.1 | **Paste** (⌘V of a screenshot/copied image) and **drag-drop** an image file onto the editor inserts it into the note at the caret. |
| FR-2.2 | Image bytes travel over IPC to the main process, which writes them into the vault (layout: §5.1) with a collision-proof name: `YYYYMMDD-HHMMSS-<slug-or-hash>.<ext>`. Renderer never touches the filesystem directly (keep `contextIsolation` intact). |
| FR-2.3 | Markdown embed syntax written into the note: `![[<filename>]]` (Obsidian-compatible). The app must also *render* standard `![](path)` if the user types it. |
| FR-2.4 | Images render inline in the app via a **read-only custom protocol** (`vault://`) registered in main, path-restricted to the vault directory (reject `..`, symlinks out); CSP gains `img-src vault:`. |
| FR-2.5 | Deleting a note (soft-delete to `.trash`) does **not** delete its images. Orphaned images are never auto-deleted (vault rule). *(A manual "orphaned attachments" report is a Could.)* |
| FR-2.6 | Keyword extraction and title extraction must ignore embed syntax (don't tokenize filenames into keywords). |
| FR-2.7 | Accepted types: png, jpg/jpeg, gif, webp. **HEIC (iPhone photos) is converted to JPEG on import** (user-approved decision): decode in the renderer via a canvas/`createImageBitmap` path if Chromium supports the codec, else use `nativeImage` in main; write only the resulting `.jpg` to `_assets/` — never store the original HEIC in the vault. Reasonable size guard (warn > ~20 MB), never silently drop. |

### FR-3: Rendering photos in the editor (Must — minimum viable form)

The textarea cannot show images. Chosen approach (see §5.2 for alternatives):

| ID | Requirement |
|---|---|
| FR-3.1 | Add a **Preview toggle** to the editor view (`✎ Write / 👁 Read`, keyboard `⌘E`). Read mode renders the note's markdown — at minimum: headings, paragraphs, lists, `[[links]]` (clickable), and images. Write mode stays the current textarea. **Notes open in write (edit) mode by default** (user-approved decision). |
| FR-3.2 | Rendering is done with a small local renderer (either a ~50-line subset renderer in-repo, or `marked` vendored locally — no CDN, CSP stays `'self'`). All output sanitized (no raw HTML pass-through). |
| FR-3.3 | In **write mode**, an image embed line shows a subtle affordance (e.g. 📷 gutter mark or thumbnail strip under the meta bar) so the user knows photos are attached without leaving write mode. *(Should.)* |

### FR-4: Many-categories hardening (Should)

| ID | Requirement |
|---|---|
| FR-4.1 | Nothing in code, seeds, or copy assumes specific category names. Seed vault only ever populates a *completely empty* vault (already true — keep the invariant, add a test). |
| FR-4.2 | Sidebar: categories collapsible; collapsed state remembered per session. Needed at 20 categories. |
| FR-4.3 | Graph: category colors extend beyond the 8-color palette deterministically (hash → HSL) so 9th+ categories don't collide. |
| FR-4.4 | Quick-switcher (`⌘P`: fuzzy find note by title, KR/EN) — the Obsidian muscle-memory feature that keeps big vaults navigable. *(Could, M3.)* |

### FR-5: Portable-disk backup (Must — this closes the "no backups" risk in AGENTS.md)

**Operational facts (already done, 2026-07-07):** the user's Seagate portable drive was reformatted from NTFS (read-only on macOS) to **exFAT**, volume name `Seagate`, mounted at `/Volumes/Seagate`. The first backup snapshot exists at `/Volumes/Seagate/graph-diary-backups/2026-07-07-213458/` (`repo/` + `vault/`, verified file-count match against source).

| ID | Requirement |
|---|---|
| FR-5.1 | Backup layout: `/Volumes/Seagate/graph-diary-backups/<YYYY-MM-DD-HHMMSS>/` containing `repo/` (this project, excluding `node_modules` and `.DS_Store`) and `vault/` (full copy of the live vault). |
| FR-5.2 | Backups are **strictly additive snapshots**: every run creates a new timestamped folder. Never `rsync --delete`, never overwrite or prune an existing snapshot. The backup tool must be incapable of writing to the *source* vault (source paths passed read-only / copy direction hard-coded). |
| FR-5.3 | An in-app **"⇪ Back up" button** (sidebar footer, next to the vault path): IPC `backup:run` in `main.js` performs FR-5.1, then reports snapshot path + file counts (source vs copy) in the UI. If `/Volumes/Seagate` is not mounted, show "drive not connected" — never fall back to another destination silently. |
| FR-5.4 | Verification is part of the backup: after copy, compare recursive file counts (and total bytes) of source vault vs snapshot vault; a mismatch marks the backup failed and says so loudly. |
| FR-5.5 | Snapshot pruning is **manual only** (the user deletes old folders in Finder if the disk ever fills; 3.6 TB ≫ vault size, so not a near-term concern). The app never deletes anything on the backup drive. |
| FR-5.6 | CLI parity: `npm run backup` runs the same logic headlessly, so backups don't require opening the app. *(Should.)* |

---

## 5. Key design decisions

### 5.1 Where photos live — **Decision (user-approved): `vault/<category>/_assets/`** (visible in Finder)

| Option | Layout | Pros | Cons |
|---|---|---|---|
| A. Per-category asset folder **(chosen)** | `vault/daily-diary/_assets/20260707-…jpg` | Photos travel with their category; visible in Finder for browsing; per-category folders stay tidy | Scanners must learn to skip `_`-prefixed dirs (one-line change ×2); moving a note across categories leaves its images behind (harmless — embeds resolve vault-wide, see below) |
| B. One vault-level folder | `vault/_attachments/` | Simplest mental model | One giant folder at 2,000 photos; same move caveat |
| C. Note-as-folder | `vault/cat/note/index.md + photos` | Photos truly "with" the note | Restructures every existing note file — violates migrate-in-place spirit, touches every vault file; rejected |

**Implementation note for the agent:** the user chose **visible `_assets`** over hidden `.assets`, so the two vault scanners must each skip `_`-prefixed directories in addition to the existing dot-skip:
- `listNotes()` in `main.js` — the `cat.name.startsWith('.')` check becomes `startsWith('.') || startsWith('_')`.
- The `categories:list` IPC handler in `main.js` — same change.
- `note:move` / `note:reclassify` / `category:create` must never target an `_`-prefixed name (guard in `slugify` consumers or the handlers themselves).

**Resolution rule** (what makes the move-caveat harmless): `![[name.jpg]]` resolves by searching the note's own category `_assets/` first, then all other `_assets/` folders — same as Obsidian's "shortest path" resolution. Files are found wherever they are; nothing needs to move when a note moves.

### 5.2 How to render images — alternatives considered

| Option | Verdict |
|---|---|
| Write/Read toggle with markdown preview **(chosen)** | Matches project's dependency-free ethos; smallest correct step; Obsidian itself started here |
| Live split-pane preview | Double the screen cost on a 1280-px window; can be added later on top of the same renderer |
| CodeMirror 6 live-preview (true Obsidian feel) | Best UX, but a real dependency + build step for a repo that currently has none; revisit as v3 |

### 5.3 Graph edge model (summary of FR-1)

```
edge types:
  link      solid, weight 1 per direction, any category   ← primary
  keyword   dashed, ≥2 shared keywords, toggle, default OFF
node types:
  note      colored by category (extended palette)
  ghost     unresolved [[target]], hollow, click-to-create
```

### 5.4 Security/robustness invariants
- `contextIsolation` stays on; no `fs` in renderer; all new IPC goes through `preload.js`.
- `vault://` protocol: canonicalize + prefix-check against `VAULT`, read-only, image MIME only.
- All writes remain additive; the only file-moving operations stay the existing collision-safe rename patterns.

---

## 6. Milestones

**M1 — Graph fix (small, immediate)**
Remove same-category restriction; demote keyword edges behind toggle with ≥2-keyword threshold; tune spring constants; extended color palette.
*Acceptance:* create note A in category X linking `[[B]]` in category Y → solid edge appears; with toggle off, two unlinked notes sharing one keyword show no edge.

**M2 — Photo pipeline (the core of this PRD)**
`vault://` protocol + CSP; `attachment:save` IPC; paste & drag-drop in editor; `_assets/` storage (+ scanner skip for `_`-dirs); HEIC→JPEG conversion; embed insertion; keyword extractor ignores embeds.
*Acceptance:* paste a screenshot → file appears in `vault/<cat>/_assets/`, note gains `![[…]]`, no keyword pollution; import a HEIC → a `.jpg` lands in `_assets/` and renders; restart app → nothing lost; `_assets` never appears as a category in the sidebar.

**M3 — Reading & navigation**
Write/Read toggle with renderer (images, clickable `[[links]]`, headings/lists); backlinks panel; ghost nodes; collapsible sidebar.
*Acceptance:* Read mode shows the photo inline and clicking a `[[link]]` navigates; backlinks panel lists inbound links.

**M4 — Scale & polish (as needed)**
Quick-switcher, thumbnail strip in write mode, orphaned-attachment report.

**M5 — Backup button (FR-5; small, can be done any time, even before M1)**
`backup:run` IPC + sidebar button + `npm run backup`; additive timestamped snapshots to `/Volumes/Seagate/graph-diary-backups/` with file-count verification.
*Acceptance:* click ⇪ Back up → new timestamped folder appears with `repo/` + `vault/`, UI reports matching file counts; unplug the drive and click again → clear "drive not connected" message, no error thrown, nothing written elsewhere; existing snapshots untouched byte-for-byte.

Each milestone ships independently; M1 alone already fixes the user's stated complaint. M5 is the cheapest risk-reduction in the whole PRD — implementing it first is encouraged.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Any migration bug touching the vault | **There is no migration.** Every feature is additive (`_assets/` is a new folder; embeds are new text written by normal save flow). Backup-first rule still applies to development testing — use a throwaway `userData` dir, never the real vault. |
| Keyword-edge removal makes existing graph feel "emptier" | Toggle keeps the old behavior one click away; default-off is the correct Obsidian-like default. |
| `vault://` path traversal | Canonicalize + prefix check + extension allowlist; tests for `..` and absolute-path escapes. |
| Renderer XSS via note content in Read mode | No raw-HTML pass-through; escape-by-default renderer. |
| Large pasted images bloat the vault | Size warning (FR-2.7); optionally downscale-on-paste behind a setting later. |

## 8. Resolved questions (user's final answers — do not re-open)

1. **Asset folder:** visible **`_assets/`** per category (not hidden `.assets`). Scanners must skip `_`-prefixed dirs — see §5.1.
2. **Keyword bridges:** default **OFF**, behind the legend toggle, ≥2 shared keywords when on (accepted as proposed).
3. **HEIC:** **convert to JPEG on import**; only the `.jpg` is stored in the vault (FR-2.7).
4. **Default view:** notes open in **write (edit) mode**; Read mode is opt-in via toggle / ⌘E (FR-3.1).

## 9. Handoff checklist for the implementing agent

Work milestone by milestone (§6); each ships independently. Before touching anything:

1. **Read `AGENTS.md` in the repo root and obey it absolutely.** The vault at `~/Library/Application Support/graph-diary/vault/` is irreplaceable user data. Never delete, overwrite, truncate, or re-seed it. For all testing, point Electron at a throwaway `userData` dir (e.g. `electron . --user-data-dir=/tmp/gd-test`) — never run experiments against the real vault. A backup snapshot exists at `/Volumes/Seagate/graph-diary-backups/` (see FR-5), but its existence is **not** a license to be careless with the source — the drive may not be plugged in.
2. There is **no data migration** in this PRD — every feature is additive. If you believe you need to modify existing vault files in bulk, stop and ask the user first.
3. Keep the project's constraints: no new npm dependencies without user sign-off (a vendored-local `marked` for FR-3.2 is pre-approved as the only exception), `contextIsolation` on, no `fs` in the renderer, all new filesystem access via IPC handlers in `main.js` exposed through `preload.js`.
4. The user writes in **Korean** — any text matching (link resolution, quick-switcher fuzzy find, filename slugs) must remain Hangul-aware (`slugify` and `tokenize` in `main.js` show the existing pattern).
5. Verify against the acceptance criteria written under each milestone in §6 before calling a milestone done; run the app with `npm start`.
6. Suggested commit granularity: one commit per milestone, message prefixed `M1:`/`M2:`/`M3:`/`M4:`.

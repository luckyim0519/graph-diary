# PRD — Graph Diary v3: Obsidian-Parity Core

- **Status:** 🔄 In progress — see implementation log below.
- **Author:** Claude (manager mode), for luckyim
- **Date:** 2026-08-01
- **Scope:** `graph-diary` Electron app (this repo, `/Users/luckyim/Desktop/projects/notes`)
- **Audience:** the implementing agent. Self-contained; read `AGENTS.md` first, then this. §1 describes the as-built code — do not re-derive it.

## Implementation log

| Milestone | Status | Notes |
|---|---|---|
| OP-1 — FR-A search + FR-B quick switcher | ✅ | Search input in sidebar (`renderer/app.js` `searchNotes`/`renderSearchResults`), debounced 150ms, AND-matches title/body/keywords/theme/subtheme/category, best-first scoring, `<mark>` snippet highlight, Esc restores tree. Quick switcher modal (`#quick-switcher`) on Cmd+O/Cmd+P, arrow-key nav, Enter opens, "Create…" row when no title matches. Verified against `/tmp/gd-parity-test` via CDP-driven Playwright: Korean term `커피` found the note with highlighted snippet, Esc restored the tree, Cmd+O/Cmd+P filtered and opened/created notes. |
| OP-2 — FR-C rename-safe links | ✅ | `main.js`: `renameLinksSync`/`rewriteLinksInBody`/`snapshotVaultForRename`, wired into both `note:save` and `note:save-sync`. Detects a first-`#`-heading change vs. the on-disk previous body, rewrites every other note's `[[old title]]` (case-insensitive, `![[embed]]` excluded) to `[[new title]]`, atomic temp-file+rename per file, one `cp`-equivalent vault snapshot per session under `vault/.trash/rename-backup-<timestamp>/` (per-top-level-entry copy — Node's `fs.cp`/`cpSync` refuses dest-inside-src, confirmed by test). Ambiguous renames (new title collides with another note) skip the rewrite and report `rename ambiguous, links not updated`; slug/filename never changes. Verified against `/tmp/gd-parity-test`: renamed "Master Plan" → linking note's `[[Master Plan]]` updated on disk + snapshot dir appeared; `![[embed]]` text left untouched while a case-insensitive `[[link]]` was rewritten; multiple occurrences in one file counted individually ("3 links updated"); ambiguous rename (renamed a note's heading to collide with an existing title) left all other files' checksums unchanged and reported the ambiguous message. |
| OP-3 — FR-D backlinks/unlinked mentions + FR-E ghost nodes | ✅ | `renderer/index.html`/`style.css`: collapsible "Linked mentions"/"Unlinked mentions" panel under the editor split (bounded height 240px, scrollable, doesn't shrink the editor). `renderer/app.js`: `renderMentions`/`linkedLinesIn`/`firstPlainOccurrence`/`linkUnlinkedMention`, refreshed on note open and after every save (`refreshMentions`). Unlinked "Link" button wraps the first plain-text occurrence into `[[…]]` and saves. `buildGraphData()` now emits a ghost node (`ghost:<lowercased title>`) for every `[[link]]` with no resolving target instead of dropping it; `graph.js` `_drawNode` renders ghosts hollow/dashed/no-category-color; clicking a ghost (or an unresolved wikilink in the preview, styled `.wikilink-ghost`) reuses the existing new-note modal prefilled with the link's title and the linking note's category (`createFromUnresolvedLink`), and the node/link resolves once created. Verified against `/tmp/gd-parity-test` via CDP-driven Playwright: linked-mentions listed a real backlink with its line; a plain-text mention showed under unlinked mentions and the Link button correctly rewrote the source file; a `[[Nonexistent Idea]]` link produced a ghost node + muted preview span, clicking either opened a prefilled create modal, and after creating the note the ghost disappeared from `ghostIndex`. |

---

## 0. Hard constraints (non-negotiable)

1. **The vault is irreplaceable personal data.** Every change must be additive or migrate-in-place. No delete/re-seed. Any migration touching note files must be preceded by a timestamped `cp -R` backup of the vault.
2. **Local, private, plain files.** Notes stay ordinary Markdown + frontmatter, openable in Obsidian. No cloud, no database, no heavyweight dependencies (no search libraries, no markdown libraries — everything hand-rolled like the existing code).
3. **Out of scope, permanently (user decision 2026-08-01):** journaling automation, daily-note generation, habit tracking, weekly logs, review generation, templates. Do not reintroduce anything resembling the removed life-assistant. The diary is manual: the user creates notes in their own categories.
4. Existing non-goals stand: no WYSIWYG editor, no plugins, no sync, no mobile.

## 1. As-built architecture (read the code, this is a map)

| Layer | File | Notes |
|---|---|---|
| Main / storage | `main.js` | Vault at `userData/vault`, one folder per category, `.md` files with `---` frontmatter (`date`, `theme`, `subtheme`, `keywords`). Auto keyword extraction (Korean+English, stopwords + 조사 stripping). IPC: list/save/create/move/reclassify/delete(soft to `.trash`)/attachment/backup. `vault://` protocol serves `_assets/` images. |
| Bridge | `preload.js` | `window.api.*` wrappers. |
| UI shell | `renderer/app.js` | Sidebar tree (year → category → theme → sub-theme), textarea editor, `[[link]]` autocomplete + cmd-click follow, debounced save + sync save on close, drag-drop reclassify, split-pane markdown preview (hand-rolled renderer), photo paste/drop. |
| Graph | `renderer/graph.js` | Dependency-free force graph, 2D/3D toggle, link edges + optional keyword bridges. |
| Posts | `renderer/posts.js` | Instagram-style feed + photo grid. |

Titles are derived from the first `# heading`; links `[[Title]]` resolve by title or slug, case-insensitive (`followLink`, `buildGraphData`).

## 2. Goal

Close the gap between this app and Obsidian's **core note-taking ergonomics** — find any note instantly, trust links to never break, see connections from both directions — while keeping the diary-specific structure (categories/themes, Posts feed, graph) that Obsidian doesn't have.

## 3. Functional requirements

### FR-A: Full-text search (Must) — the biggest gap

- **A.1** A search input at the top of the sidebar (below the `+ Note / + Category` row). Typing filters live.
- **A.2** Matches note **title, body, keywords, theme, subtheme, category** — case-insensitive, Korean and English. Multiple space-separated terms AND together.
- **A.3** Results replace the tree while a query is active: flat list, best-first (title match > keyword match > body match), each row showing title, category pill, and a one-line body snippet with the match highlighted. Clearing the input (or Esc) restores the tree.
- **A.4** Implementation: in-memory over the already-loaded `notes` array in the renderer. No index files, no libraries. 1,000 notes must filter in <50 ms per keystroke (debounce ~150 ms is fine).

### FR-B: Quick switcher (Must)

- **B.1** `Cmd+O` (and `Cmd+P`) opens a centered modal with a text input — Obsidian's quick switcher.
- **B.2** Fuzzy-ish title match (same contains-matching as the existing `[[` autocomplete is acceptable), max ~10 results, arrow keys + Enter to open, Esc to close.
- **B.3** If no note matches, the first row offers "Create ‘query’…" → creates in the currently open note's category (or the first category), mirroring the `[[` autocomplete's create path.

### FR-C: Rename-safe links (Must) — data integrity

- **C.1** When a save changes a note's title (first `# heading` differs from the previous title), find every other note whose body contains `[[old title]]` (case-insensitive, also `![[…]]` excluded) and rewrite it to `[[new title]]`. Do this in main process at save time, atomically per file.
- **C.2** Before the very first rewrite in a session, snapshot the vault: `cp -R` to `vault/.trash/rename-backup-<timestamp>/` — cheap insurance per constraint 0.1. One snapshot per session is enough.
- **C.3** Show feedback in `#save-state`: `saved ✓ · 3 links updated`.
- **C.4** The slug/filename does **not** change on rename (links resolve by title first; slug stays the stable file identity). Collisions: if the new title equals another existing note's title, skip the rewrite and show `saved ✓ · rename ambiguous, links not updated`.

### FR-D: Backlinks & unlinked mentions (Must — closes owed FR-1.6)

- **D.1** A collapsible "Linked mentions" section under the editor's preview pane (or a right-edge panel — implementer's choice, but it must not shrink the editor below usability): every note whose body links `[[this note]]`, as clickable rows with a snippet of the line containing the link.
- **D.2** Below it, "Unlinked mentions": notes whose body contains this note's title as plain text (not inside `[[ ]]`), each row with a **Link** button that wraps the first occurrence into `[[…]]` and saves that note.
- **D.3** Both computed in the renderer from the loaded `notes` array; refresh when the open note changes or after any save.

### FR-E: Ghost nodes (Must — closes owed FR-1.3)

- **E.1** `[[Links]]` whose target doesn't exist render in the graph as hollow/dashed "ghost" nodes (dimmed, no category color).
- **E.2** Clicking a ghost node prompts (existing modal) to create that note — category defaults to the linking note's category. After creation the node becomes real.
- **E.3** In the editor preview, unresolved wikilinks render in a distinct muted style; clicking one offers the same create flow (currently `followLink` silently does nothing).

### FR-F: Tags (Should)

- **F.1** Parse inline `#tag` tokens from note bodies (Korean and English word chars; exclude markdown headings — `#` followed by space is a heading, `#word` is a tag).
- **F.2** Tags render highlighted in the preview; clicking a tag runs a search for it (reuses FR-A with a `#tag` term type that matches tags only).
- **F.3** A "Tags" section at the bottom of the sidebar listing all tags with counts; click → same search.
- **F.4** Tags are derived at load/save time in the renderer — **no frontmatter change, no file rewrites.** (Auto-keywords stay as they are; tags are the user-controlled vocabulary, keywords the automatic one.)

### FR-G: Markdown preview upgrades (Should)

- **G.1** Task lists: `- [ ]` / `- [x]` render as real checkboxes; clicking a checkbox in the preview toggles the `x` in the source text and saves. (This is manual diary state, not habit tracking.)
- **G.2** Blockquotes (`> `), horizontal rules (`---` outside frontmatter), and fenced code blocks (``` … ```) render properly.
- **G.3** Keep the renderer hand-rolled in `app.js`'s `markdownToHtml`; keep escaping HTML first (XSS: note content must never inject markup — preserve the existing `escHtml`-before-transform order).

### FR-H: Sidebar & navigation QoL (Should — closes owed FR-4.2)

- **H.1** Year, category, theme, and sub-theme headers toggle collapse on click; collapsed state persists in `localStorage`.
- **H.2** A sort toggle in the sidebar header: **A–Z / newest first** (by `date`). Persisted in `localStorage`. Default stays A–Z.
- **H.3** `Cmd+E` toggles between editor and graph tabs; `Cmd+F` focuses the search input.

### FR-I: External-change watching (Could)

- **I.1** `fs.watch` on the vault (recursive) in main; debounce ~500 ms; notify the renderer to `refresh()` when files change on disk (e.g. the user edits the vault in Obsidian).
- **I.2** Never clobber the open editor: if the changed file is the currently open, dirty note, keep the editor's version and show `changed on disk — your version kept` in `#save-state`.

### Could (explicitly deferred, do not build now)
Local per-note graph view; pinned/starred notes; command palette; orphaned-attachments report.

## 4. Milestones & acceptance

Work in this order; one commit per milestone, message prefixed `OP-<n>`.

| # | Contents | Acceptance (verify by launching the app — `npm start` — against a **copy** of the vault or the seed vault, never destructively against the real one) |
|---|---|---|
| OP-1 | FR-A search + FR-B quick switcher | Type a Korean word from a note body → note found with snippet; Esc restores tree. Cmd+O, type, Enter → note opens. |
| OP-2 | FR-C rename-safe links | Rename a linked note's heading → other notes' `[[links]]` updated on disk; snapshot exists under `.trash/`; ambiguous rename skipped with message. |
| OP-3 | FR-D backlinks + FR-E ghost nodes | Open a linked-to note → linked mentions listed; unlinked mention linkable with one click. Graph shows ghost for `[[Nonexistent]]`; clicking creates it. |
| OP-4 | FR-F tags + FR-G preview | `#tag` clickable in preview and listed in sidebar; checkbox click toggles source; code fence renders. |
| OP-5 | FR-H sidebar QoL (+ FR-I if time allows) | Collapse persists across restart; date sort works; shortcuts work. |

After each milestone, update the implementation-log table you should add at the top of this file (mirror the pattern in `PRD-graph-and-photos.md`).

## 5. Decided questions (do not re-open)

1. Search is renderer-side in-memory — no index persistence.
2. Rename updates links by title only; filenames/slugs never change (§FR-C.4).
3. Tags are body-derived, never written to frontmatter.
4. No new npm dependencies of any kind.
5. Backlinks panel placement is the implementer's choice within FR-D.1's usability bound.
6. All UI text can stay English except where existing UI is Korean; match surrounding style.

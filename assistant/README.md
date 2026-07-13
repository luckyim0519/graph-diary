# Life Assistant

A personal review system inside Graph Diary: daily journal + weekly habit logs +
monthly transaction CSVs in the vault → LLM-written weekly/monthly reviews where
**every number is computed deterministically in code** (`stats.js`) and the model
only writes narrative.

File formats are specced by the templates in `../life-assistant/` — do not
redesign them. Data lives in the vault under `journal/`, `habits/`, `finances/`,
`reviews/` (reviews are ordinary notes: they show up in the tree and graph, and
link to their sources via `[[wikilinks]]`).

## Setup

1. **API key** (only needed for review generation; everything else is offline):
   - `export ANTHROPIC_API_KEY=sk-ant-...` in your shell, **or**
   - macOS keychain (works when the app is launched from Finder):
     `security add-generic-password -s anthropic-api-key -a "$USER" -w <key>`
   - The key is never written to the vault or repo; prompts are never logged.
2. **FX rates** — edit `assistant/config.yaml` (`fx:` block, units of CAD per 1
   USD/KRW). Rates are fixed by design (offline, private); each review records
   the rates it used in its frontmatter.

## Commands

| Command | What it does |
|---|---|
| `npm run assistant -- new journal [YYYY-MM-DD]` | Today's (or given date's) journal from the template, date/week pre-filled. Never overwrites. |
| `npm run assistant -- new logs [YYYY-Www]` | This (or given) week's exercise + study logs. |
| `npm run assistant -- validate 2026-07` | Validate a transactions CSV. Errors block reviews; duplicates only warn. |
| `npm run assistant -- stats week 2026-W28` | The PeriodStats JSON (also `stats month 2026-07`). |
| `npm run assistant -- review week 2026-W28` | Generate the weekly review (validates CSVs first, archives any existing review to `reviews/.archive/`, fails loudly rather than writing a partial file). |
| `npm run assistant -- review month 2026-07` | Monthly review. |
| `... review ... --dry-run` | Print the deterministic skeleton without calling the API. |
| `npm test` | Unit tests (aggregation is the correctness core — keep them green). |

In the app: **📓 오늘 일기 · 🏃 주간 로그 · 🧾 리뷰** buttons in the sidebar.

## Semantics worth knowing

- **Savings rate** = (income − fixed − discretionary) / income. `invest` rows
  are treated as saved (excluded from spending); `transfer` rows are excluded
  from all math.
- **Weekly finance slice** can span two monthly CSVs (ISO weeks cross months);
  both are loaded and filtered by date.
- **Missing data is reported, never zero-filled**: no exercise log → the review
  says so; a journal entry with blank mood/energy/sleep is excluded from the
  averages and named in `incompleteFrontmatter`.
- **Monthly exercise/study targets** are the sum of the per-week targets found
  in that month's logs.

## Adding a new transaction category

Don't, unless necessary — a stable taxonomy is what makes month-over-month
comparison meaningful. If you truly need one: add it to `CATEGORIES` in
`assistant/validate.js`, and accept that past months simply won't have it.

## Troubleshooting

- **"No API key"** — set `ANTHROPIC_API_KEY` or add the keychain item (see Setup).
- **"transactions CSV has errors — review blocked"** — run
  `npm run assistant -- validate <month>`; the report names each bad line.
  Common: date outside the file's month, positive expense amount, a category
  not in the fixed list, thousands separators in amounts.
- **Review looks stale after edits** — rerun the review command; the previous
  version is archived to `reviews/.archive/`, never lost.
- **Numbers look wrong** — `stats <kind> <period>` shows exactly what the model
  was given; the model cannot change them (the numbers section is spliced back
  from code after generation).
- **Testing** — point the assistant at a throwaway vault with `GD_VAULT=/tmp/...`.
  Never experiment against the real vault (see AGENTS.md).

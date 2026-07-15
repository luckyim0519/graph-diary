# PRD — Habit UI: check-off logging + coloring heatmaps

- **Status:** ✅ Approved verbally (Lucky, 2026-07-14) — "I don't like the markdown thing"
- **Supersedes:** the assumption in the Life Assistant handoff that habit logs are edited by hand as markdown tables. **Storage format is unchanged** (tables in `habits/*.md`, per `life-assistant/templates/`) — this PRD adds a UI layer so the user never touches them.

## Requirements

| ID | Requirement |
|---|---|
| H-1 | New **✅ Habits** tab with an Exercise section and a Study section. |
| H-2 | **Quick-log form** per section: date (defaults to today; clicking a heatmap cell targets that date), one-tap **type chips**, minutes, and the scores (exercise: intensity/feel 1–5; study: depth 1–5 + output yes/no), optional note. Saving appends a table row to the correct `habits/<name>-YYYY-Www.md` (creating it from the template if absent) — **append-only, migrate-in-place; never rewrites existing rows** (corrections happen in the note editor). |
| H-3 | **Exercise types are Lucky's, not the handoff's** (documented schema deviation): seeded as Pilates, Gym, Band Stretching, Swimming, Kayaking, Walk, Run, Other — editable in `assistant/config.yaml` (`exercise_types`). A free-text field covers one-offs. Study "areas" are chips built from `focus_areas` + previously used areas + free text. |
| H-4 | **Coloring heatmaps** (GitHub-contribution style): one per section, ~16 weeks, columns = ISO weeks, rows = Mon–Sun; cell color intensity scales with minutes that day; today outlined; hover shows date + entries; click targets the quick-log form at that date. Study uses the green scale ("coloring in" days you studied); exercise uses blue. |
| H-5 | **This-week progress**: sessions vs `target_sessions` and hours vs `target_hours` as small progress bars above each heatmap. |
| H-6 | Aggregation engine, reviews, validator, and templates keep working unchanged — the UI writes exactly the rows `stats.js` already parses. |

## Non-goals (v1)
Editing/deleting logged rows in the UI (open the log note instead); month view; streak gamification.

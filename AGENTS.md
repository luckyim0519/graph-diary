# AGENTS.md — rules for any AI agent working in this repo

## 🚨 CRITICAL RULE #1 — NEVER DELETE THE VAULT

The user's personal diary is stored at:

```
~/Library/Application Support/graph-diary/vault/
```

This folder contains **irreplaceable, personal diary entries** (`.md` files,
organized into category subfolders). There are **no backups** and the data
**cannot be recovered** if lost (internal Apple SSD with TRIM zeroes deleted
blocks immediately).

A diary entry was already permanently lost once because an agent ran
`rm -rf` on this folder to "re-seed" it. **This must never happen again.**

### Absolutely forbidden
- ❌ `rm`, `rm -rf`, `unlink`, `mv`, or `find ... -delete` on the vault or
  anything inside it.
- ❌ Overwriting vault files to "re-seed" or reset to examples.
- ❌ Deleting the vault to test a new file/header format.
- ❌ Any command that could truncate, clear, or replace vault contents.

### Required instead
- ✅ Treat the vault as **read-only user data**. Only the running app writes to
  it through its normal save flow.
- ✅ If a file-format/header change needs migrating, **migrate in place**
  (read → transform → write the same file). Never delete-and-recreate.
- ✅ **Back up first.** Before ANY operation that touches the vault, copy it:
  `cp -R "<vault>" "<vault>.backup-$(date +%Y%m%d-%H%M%S)"`
- ✅ To test seeding/format changes, point the app at a **throwaway vault**
  via a temp `userData` dir or a test path — never the real vault.
- ✅ Seeding logic must only ever ADD files when the vault is empty; it must
  never remove or replace existing files.

If you are ever unsure whether an action could affect the vault, **stop and
ask the user first.**

## Project notes
- Electron diary app. Notes = Markdown files; category folder → theme →
  subtheme → note. Headers carry `date`, `theme`, `subtheme`, `mood`,
  `emotions`, `keywords`.
- The user writes entries in **Korean**; keep text features Korean-aware.
- The user prefers **local / offline / private** processing (no cloud, no
  sending diary text to external APIs unless explicitly asked).
- Run the app with `npm start`. Do not wipe `userData` to "reset" it.

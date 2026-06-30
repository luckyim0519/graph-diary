# 📓 Graph Diary

A personal diary where every note is a plain Markdown file and notes link to
each other into a graph — like Obsidian, but tiny and yours.

Each **category** is a folder (e.g. `villain-diary`, `daily-diary`). Inside the
app, categories show up as colored clusters in the graph.

## Run it

```bash
npm install
npm start
```

## How it works

- **Notes are Markdown files** stored on disk at
  `~/Library/Application Support/graph-diary/vault/<category>/<note>.md`.
  You can open, back up, or edit them with any other tool.
- **Linking** — type `[[` in the editor to get an autocomplete of your notes.
  Pick one (or create a new one on the fly) to insert a `[[wiki-link]]`.
  `Cmd/Ctrl + click` a link to jump to that note.
- **Graph view** — switch to the 🕸 Graph tab to see every note as a node,
  colored by category, with edges drawn from your links. Drag nodes, scroll to
  zoom, drag the background to pan, hover to highlight a note's connections, and
  click a node to open it.

## Make it yours

- `+ Category` to add a new diary (Travel Journal, Dream Log, …).
- `+ Note` to add a note inside a category.
- A note's title is its first `# Heading`.

The first launch seeds a couple of example notes across two categories so the
graph isn't empty — delete them once you've got your own.

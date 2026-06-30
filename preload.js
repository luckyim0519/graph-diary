const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge between the renderer UI and the filesystem-backed main process.
contextBridge.exposeInMainWorld('api', {
  listNotes: () => ipcRenderer.invoke('notes:list'),
  listCategories: () => ipcRenderer.invoke('categories:list'),
  saveNote: (id, content, theme, subtheme) =>
    ipcRenderer.invoke('note:save', { id, content, theme, subtheme }),
  saveNoteSync: (id, content, theme, subtheme) =>
    ipcRenderer.sendSync('note:save-sync', { id, content, theme, subtheme }),
  createNote: (category, title, theme, subtheme) =>
    ipcRenderer.invoke('note:create', { category, title, theme, subtheme }),
  deleteNote: (id) => ipcRenderer.invoke('note:delete', { id }),
  createCategory: (name) => ipcRenderer.invoke('category:create', { name }),
  vaultPath: () => ipcRenderer.invoke('vault:path'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  analyzeMoods: (force) => ipcRenderer.invoke('moods:analyze', { force }),
});

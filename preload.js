const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge between the renderer UI and the filesystem-backed main process.
contextBridge.exposeInMainWorld('api', {
  listNotes: () => ipcRenderer.invoke('notes:list'),
  listCategories: () => ipcRenderer.invoke('categories:list'),
  saveNote: (id, content, theme, subtheme, date) =>
    ipcRenderer.invoke('note:save', { id, content, theme, subtheme, date }),
  saveNoteSync: (id, content, theme, subtheme, date) =>
    ipcRenderer.sendSync('note:save-sync', { id, content, theme, subtheme, date }),
  createNote: (category, title, theme, subtheme) =>
    ipcRenderer.invoke('note:create', { category, title, theme, subtheme }),
  deleteNote: (id) => ipcRenderer.invoke('note:delete', { id }),
  moveNote: (id, toCategory) => ipcRenderer.invoke('note:move', { id, toCategory }),
  reclassifyNote: (id, category, theme, subtheme) =>
    ipcRenderer.invoke('note:reclassify', { id, category, theme, subtheme }),
  createCategory: (name) => ipcRenderer.invoke('category:create', { name }),
  vaultPath: () => ipcRenderer.invoke('vault:path'),
  backup: () => ipcRenderer.invoke('backup:run'),
  saveAttachment: (category, data, filename, mimeType) =>
    ipcRenderer.invoke('attachment:save', { category, data, filename, mimeType }),
  convertHeic: (data) =>
    ipcRenderer.invoke('attachment:convert-heic', { data }),
});

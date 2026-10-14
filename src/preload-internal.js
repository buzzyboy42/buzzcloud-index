// Loaded into every tab, but only exposes an API on the browser's internal pages.
// The main process re-checks the sender's URL on every call.
const { contextBridge, ipcRenderer } = require('electron');

const scheme = process.argv.find((a) => a.startsWith('--internal-scheme='))?.split('=')[1];

if (scheme && location.protocol === `${scheme}:`) {
  const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
  contextBridge.exposeInMainWorld('internal', {
    info: call('internal:info'),
    bookmarks: call('internal:bookmarks'),
    history: call('internal:history'),
    removeBookmark: call('internal:remove-bookmark'),
    removeVisit: call('internal:remove-visit'),
    clearHistory: call('internal:clear-history'),
    navigate: call('internal:navigate'),
  });
}

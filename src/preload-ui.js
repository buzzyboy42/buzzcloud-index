// Bridge for the browser's own toolbar/tab strip (src/ui). Nothing else gets it.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'ui:ready', 'tab:new', 'tab:close', 'tab:activate',
  'nav:go', 'nav:back', 'nav:forward', 'nav:reload', 'nav:stop', 'nav:home', 'nav:focus-page',
  'bookmark:toggle', 'adblock:toggle', 'menu:open',
]);

contextBridge.exposeInMainWorld('browser', {
  send(channel, ...args) {
    if (CHANNELS.has(channel)) ipcRenderer.send(channel, ...args);
  },
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onFocusAddress: (cb) => ipcRenderer.on('focus-address', () => cb()),
});

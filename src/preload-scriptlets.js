// Runs in every frame (including embedded players such as YouTube's) before
// the page's own scripts. It fetches the ad-blocking scriptlets for this page
// synchronously and runs them in the page straight away.
//
// The ad-block library's own route (async IPC, then executeJavaScript from the
// main process) can arrive after a site's scripts have already run. On YouTube
// that race shows up as a player that never loads (ad data kept but ad requests
// blocked) or as ads getting through on refresh.
const { ipcRenderer, webFrame } = require('electron');

if (location.protocol === 'http:' || location.protocol === 'https:') {
  let code = '';
  try {
    code = ipcRenderer.sendSync('adblock:scriptlets', location.href);
  } catch {}
  if (code) webFrame.executeJavaScript(code);
}

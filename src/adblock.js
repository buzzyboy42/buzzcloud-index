// Ad & tracker blocking powered by Ghostery's engine (EasyList, EasyPrivacy, ...).
//
// We wire the engine into each session ourselves instead of using
// `enableBlockingInSession`, because that helper registers global IPC handlers
// per session and so can't serve normal and private windows at the same time.
const fs = require('fs/promises');
const path = require('path');
const { ipcMain, net } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { parse } = require('tldts-experimental');

const COSMETIC_PRELOAD = require.resolve('@ghostery/adblocker-electron-preload');
const SCRIPTLET_PRELOAD = path.join(__dirname, 'preload-scriptlets.js');

// Filter lists change daily (sites like YouTube keep changing how they serve
// ads), so a cached engine older than this is rebuilt in the background.
const MAX_AGE = 2 * 24 * 60 * 60 * 1000;
const RECHECK_EVERY = 6 * 60 * 60 * 1000;
const fetchViaChromium = (url, opts) => net.fetch(url, opts);

class AdBlock {
  constructor(cacheDir, enabled) {
    this.cachePath = path.join(cacheDir, 'adblock-engine.bin');
    this.blocker = null;
    this.enabled = enabled;
    this.onBlocked = () => {};

    // Element hiding (CSS) still comes through the library's preload...
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => this.injectStyles(event, url, msg));
    // ...but scriptlets come from our own preload, before the page's scripts run.
    ipcMain.on('adblock:scriptlets', (event, url) => {
      event.returnValue = this.scriptletsFor(url);
    });
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) =>
      this.active ? this.blocker.onIsMutationObserverEnabled(event) : false,
    );

    this.ready = this.load();
  }

  get active() {
    return this.enabled && this.blocker !== null;
  }

  async load() {
    try {
      this.use(await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchViaChromium, {
        path: this.cachePath,
        read: fs.readFile,
        write: fs.writeFile,
      }));
    } catch (err) {
      console.error('Ad blocker failed to load filter lists:', err.message);
    }
    this.refreshIfStale();
    setInterval(() => this.refreshIfStale(), RECHECK_EVERY).unref?.();
  }

  use(blocker) {
    blocker.on('request-blocked', (req) => this.onBlocked(req.tabId, req.url));
    this.blocker = blocker; // the session hooks read this.blocker on every request
  }

  // Download fresh lists and swap them in; the old engine keeps working meanwhile.
  async refreshIfStale() {
    try {
      const { mtimeMs } = await fs.stat(this.cachePath);
      if (Date.now() - mtimeMs < MAX_AGE) return;
    } catch {
      // No cache yet: load() is building one.
      if (!this.blocker) return;
    }
    try {
      const fresh = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchViaChromium);
      await fs.writeFile(this.cachePath, fresh.serialize());
      this.use(fresh);
    } catch (err) {
      console.error('Ad blocker could not refresh filter lists:', err.message);
    }
  }

  // Scriptlets (uBlock Origin-style "+js(...)" rules) for a page, as one script.
  scriptletsFor(url) {
    if (!this.active) return '';
    try {
      const { hostname, domain } = parse(url);
      const { active, scripts } = this.blocker.getCosmeticsFilters({
        url, hostname: hostname || '', domain: domain || '',
        getBaseRules: false, getInjectionRules: true, getExtendedRules: false,
        getRulesFromHostname: true, getRulesFromDOM: false,
      });
      if (active === false || !scripts.length) return '';
      return scripts.map((s) => `try { ${s} } catch (e) {}`).join('\n');
    } catch {
      return '';
    }
  }

  injectStyles(event, url, msg) {
    if (!this.active) return;
    const { hostname, domain } = parse(url);
    const first = msg === undefined; // later calls carry the classes/ids found in the page
    const { active, styles } = this.blocker.getCosmeticsFilters({
      url, hostname: hostname || '', domain: domain || '',
      classes: msg?.classes, hrefs: msg?.hrefs, ids: msg?.ids,
      getBaseRules: first, getInjectionRules: false, getExtendedRules: false,
      getRulesFromHostname: first, getRulesFromDOM: !first,
      callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: msg?.lifecycle },
    });
    if (active !== false && styles.length) event.sender.insertCSS(styles, { cssOrigin: 'user' });
  }

  attach(session) {
    const pass = (_details, callback) => callback({});
    session.registerPreloadScript({ type: 'frame', filePath: SCRIPTLET_PRELOAD });
    session.registerPreloadScript({ type: 'frame', filePath: COSMETIC_PRELOAD });
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) =>
      this.active ? this.blocker.onBeforeRequest(details, callback) : pass(details, callback),
    );
    session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) =>
      this.active ? this.blocker.onHeadersReceived(details, callback) : pass(details, callback),
    );
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

module.exports = { AdBlock };

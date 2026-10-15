const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  ipcMain,
  session,
  protocol,
  net,
  clipboard,
  dialog,
  nativeTheme,
  nativeImage,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');
const brand = require('../brand.json');
const { createStores } = require('./store');
const { AdBlock } = require('./adblock');
const updater = require('./updater');
const { Backgrounds } = require('./backgrounds');

app.setName(brand.name);
protocol.registerSchemesAsPrivileged([
  { scheme: brand.scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const UI_HEIGHT = 80; // tab strip + toolbar, must match --ui-height in ui.css
const PAGES_DIR = path.join(__dirname, 'pages');
const INTERNAL = `${brand.scheme}://`;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

let store;
let adblock;
let backgrounds;
const windows = new Map(); // ui webContents id -> Win
const tabs = new Map(); // tab webContents id -> Tab
const configuredSessions = new WeakSet();
let privateCounter = 0;

const isInternal = (url) => url.startsWith(INTERNAL);
const isWeb = (url) => /^https?:\/\//i.test(url);
const isHome = (url) => !url || url.replace(/\/$/, '') === brand.homepage.replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Address bar input -> URL
// ---------------------------------------------------------------------------

function searchUrl(query) {
  const engines = brand.searchEngines;
  const template = engines[store.getSettings().searchEngine] || engines[brand.defaultSearchEngine];
  return template.replace('%s', encodeURIComponent(query));
}

function toUrl(input) {
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|view-source):/i.test(text)) return text;
  if (!/\s/.test(text)) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`;
    if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(text)) return `http://${text}`;
  }
  return searchUrl(text);
}

// ---------------------------------------------------------------------------
// Sessions: internal pages, privacy headers, permissions, ad blocking
// ---------------------------------------------------------------------------

const MEDIA_TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm' };

// Video needs byte-range responses so it can seek and loop without reloading.
async function serveMedia(file, range) {
  let size;
  try {
    ({ size } = await fs.promises.stat(file));
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = MEDIA_TYPES[path.extname(file)];
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m || (!m[1] && !m[2])) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    });
  }
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

async function serveInternal(request) {
  const { host, pathname } = new URL(request.url);
  // Saved copies of downloaded new tab backgrounds live in the user-data folder.
  const saved = host === 'newtab' && /^\/bg\/([\w-]+)\.mp4$/.exec(pathname);
  if (saved) {
    const file = backgrounds?.cachedFileFor(saved[1]);
    return file ? serveMedia(file, request.headers.get('range')) : new Response('Not found', { status: 404 });
  }
  const rel = pathname === '/' ? `${host}.html` : pathname.slice(1);
  const file = path.normalize(path.join(PAGES_DIR, rel));
  if (!file.startsWith(PAGES_DIR + path.sep)) return new Response('Not found', { status: 404 });
  if (MEDIA_TYPES[path.extname(file)]) return serveMedia(file, request.headers.get('range'));
  try {
    const res = await net.fetch(pathToFileURL(file).toString());
    // Internal pages can't be framed by websites (no clickjacking "Clear history").
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    headers.set('X-Frame-Options', 'DENY');
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// --- Favicons ---------------------------------------------------------------

const FAVICON_MAX_BYTES = 200 * 1024;
const faviconCache = new Map(); // url -> data: URL, or null if it isn't a usable image

function imageType(bytes, declared) {
  if (/^image\//i.test(declared)) return declared.split(';')[0].trim();
  const head = bytes.subarray(0, 16);
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0x00 && head[1] === 0x00 && (head[2] === 0x01 || head[2] === 0x02)) return 'image/x-icon';
  if (head[0] === 0x47 && head[1] === 0x49) return 'image/gif';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.toString('ascii', 0, 4) === 'RIFF') return 'image/webp';
  if (/^\s*(<\?xml|<svg)/i.test(bytes.subarray(0, 256).toString('utf8'))) return 'image/svg+xml';
  return null;
}

async function fetchFavicon(ses, url) {
  if (url.startsWith('data:image/')) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  const key = `${ses.storagePath || 'memory'}|${url}`;
  if (faviconCache.has(key)) return faviconCache.get(key);
  let result = null;
  try {
    const res = await ses.fetch(url, { cache: 'force-cache' });
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      const type = bytes.length ? imageType(bytes, res.headers.get('content-type') || '') : null;
      if (type && bytes.length > 16 * 1024 && /png|jpeg/.test(type)) {
        // Big icons (some sites use 512px PNGs) are shrunk to tab size.
        const img = nativeImage.createFromBuffer(bytes);
        if (!img.isEmpty()) result = img.resize({ width: 64, quality: 'best' }).toDataURL();
      } else if (type && bytes.length <= FAVICON_MAX_BYTES) {
        result = `data:${type};base64,${bytes.toString('base64')}`;
      }
    }
  } catch {
    return null; // network trouble: don't remember it, try again next time
  }
  if (faviconCache.size > 500) faviconCache.delete(faviconCache.keys().next().value);
  faviconCache.set(key, result);
  return result;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ERROR_MESSAGES = {
  ERR_NAME_NOT_RESOLVED: (host) => `${host}’s server address couldn’t be found. Check the spelling of the address.`,
  ERR_INTERNET_DISCONNECTED: () => 'You’re not connected to the internet.',
  ERR_CONNECTION_REFUSED: (host) => `${host} refused to connect.`,
  ERR_CONNECTION_TIMED_OUT: (host) => `${host} took too long to respond.`,
};

function errorPage(code, desc, url, isPrivate) {
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {}
  const message = ERROR_MESSAGES[desc]
    ? ERROR_MESSAGES[desc](host)
    : code <= -200 && code > -300
      ? `${host} has a problem with its security certificate, so the connection was stopped to protect you.`
      : `Something went wrong while loading ${host}.`;
  // Inline the stylesheets: the error document can't load files from our scheme.
  const css = ['theme.css', 'pages.css']
    .map((f) => fs.readFileSync(path.join(PAGES_DIR, f), 'utf8').replace(/@import[^;]+;/g, ''))
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(host)}</title>
<style>${css}</style></head>
<body class="${isPrivate ? 'private' : ''}"><div class="error">
<p class="eyebrow">${escapeHtml(brand.name)}</p>
<h1>This page can’t be reached</h1><p class="muted">${escapeHtml(message)}</p>
<p><code>${escapeHtml(desc)}</code></p><p class="muted">Press Reload to try again.</p>
</div></body></html>`;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cleanUserAgent(ua) {
  // Some sites block or degrade "Electron" user agents; present as plain Chrome.
  return ua
    .replace(/ Electron\/\S+/, '')
    .replace(new RegExp(` ${escapeRegExp(app.getName())}/\\S+`, 'i'), '');
}

const ASKABLE_PERMISSIONS = {
  media: 'use your camera and/or microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  'display-capture': 'share your screen',
  midi: 'use your MIDI devices',
  pointerLock: 'lock your mouse pointer',
};
const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write']);

function setupSession(ses) {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);

  ses.protocol.handle(brand.scheme, serveInternal);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));

  // Ask sites not to track or sell data (Global Privacy Control + DNT).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Sec-GPC'] = '1';
    details.requestHeaders.DNT = '1';
    callback({ requestHeaders: details.requestHeaders });
  });

  const decisions = new Map(); // "origin permission" -> boolean, for this run only
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return callback(true);
    const label = ASKABLE_PERMISSIONS[permission];
    const tab = tabs.get(wc.id);
    if (!label || !tab) return callback(false);

    let origin;
    try {
      origin = new URL(details.requestingUrl).origin;
    } catch {
      return callback(false);
    }
    const key = `${origin} ${permission}`;
    if (decisions.has(key)) return callback(decisions.get(key));

    dialog
      .showMessageBox(tab.win.bw, {
        type: 'question',
        buttons: ['Block', 'Allow'],
        defaultId: 0,
        cancelId: 0,
        title: 'Permission request',
        message: `${origin} wants to ${label}.`,
      })
      .then(({ response }) => {
        decisions.set(key, response === 1);
        callback(response === 1);
      });
  });

  adblock.attach(ses);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

class Tab {
  constructor(win, url) {
    this.win = win;
    this.view = new WebContentsView({
      webPreferences: {
        session: win.session,
        preload: path.join(__dirname, 'preload-internal.js'),
        additionalArguments: [`--internal-scheme=${brand.scheme}`],
        // Run the (sandboxed) ad-blocking preloads in iframes too, e.g. embedded
        // YouTube players. Pages still get no Node.js access.
        nodeIntegrationInSubFrames: true,
        sandbox: true,
        contextIsolation: true,
      },
    });
    this.wc = this.view.webContents;
    this.id = this.wc.id;
    this.title = 'New Tab';
    this.favicon = null;
    this.favicons = new Map(); // page URL -> favicon, so Back/Forward restore it
    this.blocked = 0;
    tabs.set(this.id, this);
    this.wire();
    this.wc.loadURL(url);
  }

  get url() {
    return this.wc.getURL();
  }

  wire() {
    const { wc, win } = this;
    const update = () => win.emit();

    wc.on('did-start-navigation', (e) => {
      if (e.isMainFrame && !e.isSameDocument) this.blocked = 0;
      update();
    });
    wc.on('did-start-loading', update);
    wc.on('did-stop-loading', update);
    wc.on('did-navigate', (_e, url, httpResponseCode) => {
      if (httpResponseCode !== -1) this.record(url); // -1: navigation failed
      this.favicon = this.favicons.get(url) || null;
      update();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.record(url);
      update();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (!win.isPrivate && isWeb(this.url)) store.updateTitle(this.url, title);
      update();
    });
    wc.on('page-favicon-updated', (_e, favicons) => this.loadFavicon(favicons));
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // -3 is ERR_ABORTED (e.g. user pressed stop or a download started)
      if (!isMainFrame || code === -3) return;
      // Draw our message into Chromium's error page in place, so the history
      // entry stays the failed URL: Back works and Reload retries.
      const html = errorPage(code, desc, url, win.isPrivate);
      wc.executeJavaScript(`document.open(); document.write(${JSON.stringify(html)}); document.close();`)
        .catch(() => {});
    });

    wc.setWindowOpenHandler(({ url, disposition }) => {
      // Real popups (window.open with features) stay popups so sign-in flows
      // that rely on window.opener keep working; everything else becomes a tab.
      if (disposition === 'new-window') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON },
        };
      }
      win.newTab(url, disposition !== 'background-tab');
      return { action: 'deny' };
    });

    wc.on('enter-html-full-screen', () => win.setFullScreen(true));
    wc.on('leave-html-full-screen', () => win.setFullScreen(false));
    wc.on('context-menu', (_e, params) => this.contextMenu(params));
  }

  // Favicons are downloaded here, through the tab's own session, and passed to
  // the tab strip as data: URLs. Loading them as <img> in the toolbar page
  // fails for sites that send Cross-Origin-Resource-Policy headers, and would
  // leak private-window favicon requests into the normal session.
  async loadFavicon(candidates) {
    const pageUrl = this.url;
    const list = [...candidates];
    try {
      list.push(new URL('/favicon.ico', pageUrl).href);
    } catch {}
    for (const url of new Set(list)) {
      const data = await fetchFavicon(this.wc.session, url);
      if (this.wc.isDestroyed() || this.url !== pageUrl) return; // navigated away meanwhile
      if (data) {
        this.favicon = data;
        this.favicons.set(pageUrl, data);
        this.win.emit();
        return;
      }
    }
  }

  record(url) {
    if (!this.win.isPrivate && isWeb(url)) store.addVisit(url, this.wc.getTitle());
  }

  contextMenu(params) {
    const { win, wc } = this;
    const sep = { type: 'separator' };
    const t = [];
    if (params.linkURL) {
      t.push(
        { label: 'Open Link in New Tab', click: () => win.newTab(params.linkURL, false) },
        { label: 'Open Link in Private Window', click: () => new Win({ isPrivate: true, url: params.linkURL }) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        sep,
      );
    }
    if (params.mediaType === 'image') {
      t.push(
        { label: 'Open Image in New Tab', click: () => win.newTab(params.srcURL, false) },
        { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Save Image As…', click: () => wc.downloadURL(params.srcURL) },
        sep,
      );
    }
    if (params.isEditable) {
      t.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, sep);
    } else if (params.selectionText) {
      const text = params.selectionText.trim();
      const short = text.length > 24 ? `${text.slice(0, 24)}…` : text;
      t.push({ role: 'copy' }, { label: `Search for “${short}”`, click: () => win.newTab(searchUrl(text)) }, sep);
    }
    t.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      sep,
      { label: 'View Page Source', enabled: isWeb(this.url), click: () => win.newTab(`view-source:${this.url}`) },
      { label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) },
    );
    Menu.buildFromTemplate(t).popup({ window: win.bw });
  }

  destroy() {
    tabs.delete(this.id);
    if (!this.wc.isDestroyed()) this.wc.close();
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

class Win {
  constructor({ isPrivate = false, url } = {}) {
    this.isPrivate = isPrivate;
    this.session = isPrivate ? session.fromPartition(`private-${++privateCounter}`) : session.defaultSession;
    setupSession(this.session);

    this.tabs = [];
    this.activeId = null;
    this.closedUrls = [];
    this.fullscreen = false;

    this.bw = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 520,
      minHeight: 320,
      title: isPrivate ? `${brand.name} (Private)` : brand.name,
      icon: ICON,
      autoHideMenuBar: true,
      backgroundColor: isPrivate ? '#0a0a0a' : nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f2f2f2',
      webPreferences: {
        session: this.session,
        preload: path.join(__dirname, 'preload-ui.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    this.ui = this.bw.webContents;
    windows.set(this.ui.id, this);
    this.ui.loadFile(path.join(__dirname, 'ui', 'index.html'));

    this.bw.on('resize', () => this.layout());
    this.bw.on('closed', () => {
      windows.delete(this.ui.id);
      for (const tab of this.tabs) tab.destroy();
      if (isPrivate) this.session.clearStorageData();
    });

    this.newTab(url || brand.homepage);
  }

  get active() {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  newTab(url = brand.homepage, activate = true) {
    const tab = new Tab(this, url);
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.tabs.splice(i < 0 ? this.tabs.length : i + 1, 0, tab);
    this.bw.contentView.addChildView(tab.view);
    tab.view.setVisible(false);
    if (activate || !this.active) this.activate(tab.id);
    else this.layout();
    this.emit();
    return tab;
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;
    for (const t of this.tabs) t.view.setVisible(t === tab);
    this.layout();
    // New tabs: the page's own search box takes the typing (see newtab.js).
    tab.wc.focus();
    this.emit();
  }

  closeTab(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [tab] = this.tabs.splice(i, 1);
    if (!isHome(tab.url)) this.closedUrls.push(tab.url);
    this.bw.contentView.removeChildView(tab.view);
    tab.destroy();
    if (this.tabs.length === 0) return this.bw.close();
    if (id === this.activeId) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else this.emit();
  }

  moveTab(id, index) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0 || !Number.isInteger(index)) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
    this.emit();
  }

  reopenClosed() {
    const url = this.closedUrls.pop();
    if (url) this.newTab(url);
  }

  cycle(step) {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length].id);
  }

  setFullScreen(on) {
    this.fullscreen = on;
    this.bw.setFullScreen(on);
    this.layout();
  }

  layout() {
    const { width, height } = this.bw.getContentBounds();
    const top = this.fullscreen ? 0 : UI_HEIGHT;
    for (const t of this.tabs) t.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  }

  focusAddress() {
    this.ui.focus();
    this.ui.send('focus-address');
  }

  go(input) {
    const url = toUrl(input);
    const tab = this.active;
    if (!url || !tab) return;
    tab.wc.loadURL(url);
    tab.wc.focus();
  }

  state() {
    const tab = this.active;
    const url = tab ? tab.url : '';
    return {
      brand: { name: brand.name },
      private: this.isPrivate,
      adblock: store.getSettings().adblock,
      updateReady: updater.state.status === 'ready' ? updater.state.version : null,
      activeId: this.activeId,
      tabs: this.tabs.map((t) => ({
        id: t.id,
        title: t.wc.getTitle() || t.title,
        favicon: t.favicon,
        loading: t.wc.isLoading(),
      })),
      active: tab && {
        url: isHome(url) ? '' : url,
        canGoBack: tab.wc.navigationHistory.canGoBack(),
        canGoForward: tab.wc.navigationHistory.canGoForward(),
        loading: tab.wc.isLoading(),
        bookmarked: isWeb(url) && store.isBookmarked(url),
        bookmarkable: isWeb(url),
        secure: url.startsWith('https://') || isInternal(url),
        blocked: tab.blocked,
      },
    };
  }

  emit() {
    if (this.emitPending) return;
    this.emitPending = true;
    setTimeout(() => {
      this.emitPending = false;
      if (!this.ui.isDestroyed()) {
        this.ui.send('state', this.state());
        const name = this.isPrivate ? `${brand.name} (Private)` : brand.name;
        this.bw.setTitle(this.active ? `${this.active.wc.getTitle() || 'New Tab'} — ${name}` : name);
      }
    }, 16);
  }
}

const focusedWin = () => {
  const bw = BrowserWindow.getFocusedWindow();
  return bw ? windows.get(bw.webContents.id) : [...windows.values()].pop();
};
const activeTab = () => focusedWin()?.active;
const allWins = () => [...windows.values()];

// ---------------------------------------------------------------------------
// Settings shared by all windows
// ---------------------------------------------------------------------------

function setAdblock(on) {
  store.setSetting('adblock', on);
  adblock.setEnabled(on);
  allWins().forEach((w) => w.emit());
  buildAppMenu();
}

function toggleBookmark(win) {
  const tab = win?.active;
  if (!tab || !isWeb(tab.url)) return;
  store.toggleBookmark(tab.url, tab.wc.getTitle());
  allWins().forEach((w) => w.emit());
}

function zoom(delta) {
  const tab = activeTab();
  if (!tab) return;
  tab.wc.setZoomLevel(delta === 0 ? 0 : tab.wc.getZoomLevel() + delta);
}

function currentBackground() {
  return store.getSettings().background || brand.defaultBackground;
}

function setBackground(id) {
  store.setSetting('background', id);
  backgrounds.cache(backgrounds.find(id));
  // Show it right away on any open new tab pages.
  for (const tab of tabs.values()) if (isHome(tab.url)) tab.wc.reload();
  buildAppMenu();
}

function setAppearance(mode) {
  store.setSetting('appearance', mode);
  nativeTheme.themeSource = mode; // 'system' | 'light' | 'dark'
  buildAppMenu();
}

function settingsMenu() {
  const settings = store.getSettings();
  const appearance = settings.appearance || 'system';
  return [
    {
      label: 'Appearance',
      submenu: [['system', 'Match System'], ['light', 'Light'], ['dark', 'Dark']].map(([mode, label]) => ({
        label,
        type: 'radio',
        checked: appearance === mode,
        click: () => setAppearance(mode),
      })),
    },
    {
      label: 'New Tab Background',
      submenu: brand.backgrounds.map((bg) => ({
        label: bg.name,
        type: 'radio',
        checked: currentBackground() === bg.id,
        click: () => setBackground(bg.id),
      })),
    },
    { type: 'separator' },
    {
      label: 'Block Ads && Trackers',
      type: 'checkbox',
      checked: settings.adblock,
      click: (item) => setAdblock(item.checked),
    },
    {
      label: 'Search Engine',
      submenu: Object.keys(brand.searchEngines).map((name) => ({
        label: name,
        type: 'radio',
        checked: settings.searchEngine === name,
        click: () => {
          store.setSetting('searchEngine', name);
          buildAppMenu();
        },
      })),
    },
    { label: 'Check for Updates…', click: () => updater.checkNow() },
    {
      label: `Make ${brand.name} the Default Browser`,
      click: () => {
        const ok = ['http', 'https'].every((p) => app.setAsDefaultProtocolClient(p));
        dialog.showMessageBox({
          message: ok
            ? `${brand.name} asked the system to make it the default browser. You may need to confirm in your system settings.`
            : 'The system did not allow changing the default browser from here. Change it in your system settings.',
        });
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Application menu (also provides all keyboard shortcuts)
// ---------------------------------------------------------------------------

function buildAppMenu() {
  const win = () => focusedWin();
  const tab = () => activeTab();
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => (win() ? win().newTab() : new Win()) },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => new Win() },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => new Win({ isPrivate: true }) },
        { type: 'separator' },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => win()?.reopenClosed() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => win()?.closeTab(win().activeId) },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => win()?.bw.close() },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => tab()?.wc.print() },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => tab()?.wc.reload() },
        { label: 'Reload', accelerator: 'F5', visible: false, acceleratorWorksWhenHidden: true, click: () => tab()?.wc.reload() },
        { label: 'Hard Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => tab()?.wc.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => zoom(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { label: 'Full Screen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: () => win()?.bw.setFullScreen(!win().bw.isFullScreen()) },
        { label: 'Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => tab()?.wc.toggleDevTools() },
        { label: 'Developer Tools', accelerator: 'F12', visible: false, acceleratorWorksWhenHidden: true, click: () => tab()?.wc.toggleDevTools() },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => tab()?.wc.navigationHistory.goBack() },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => tab()?.wc.navigationHistory.goForward() },
        { label: 'Home', accelerator: 'Alt+Home', click: () => tab()?.wc.loadURL(brand.homepage) },
        { label: 'Address Bar', accelerator: 'CmdOrCtrl+L', click: () => win()?.focusAddress() },
        { label: 'Address Bar', accelerator: 'F6', visible: false, acceleratorWorksWhenHidden: true, click: () => win()?.focusAddress() },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => win()?.cycle(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => win()?.cycle(-1) },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: n === 9 ? 'Last Tab' : `Tab ${n}`,
          accelerator: `CmdOrCtrl+${n}`,
          click: () => {
            const w = win();
            const t = n === 9 ? w?.tabs.at(-1) : w?.tabs[n - 1];
            if (t) w.activate(t.id);
          },
        })),
      ],
    },
    {
      label: 'Library',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => toggleBookmark(win()) },
        { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => win()?.newTab(`${INTERNAL}bookmarks`) },
        { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => win()?.newTab(`${INTERNAL}history`) },
      ],
    },
    { label: 'Settings', submenu: settingsMenu() },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function popupMainMenu(win) {
  const menu = Menu.buildFromTemplate([
    { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => win.newTab() },
    { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => new Win() },
    { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => new Win({ isPrivate: true }) },
    { type: 'separator' },
    { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => win.newTab(`${INTERNAL}bookmarks`) },
    { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => win.newTab(`${INTERNAL}history`) },
    { type: 'separator' },
    { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
    { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
    { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
    { type: 'separator' },
    ...settingsMenu(),
    { type: 'separator' },
    { label: 'Developer Tools', click: () => win.active?.wc.toggleDevTools() },
    { label: `About ${brand.name}`, click: () => dialog.showMessageBox(win.bw, {
      title: `About ${brand.name}`,
      message: `${brand.name} ${app.getVersion()}`,
      detail: `Chromium ${process.versions.chrome}\nElectron ${process.versions.electron}`,
    }) },
    { label: 'Quit', role: 'quit' },
  ]);
  menu.popup({ window: win.bw });
}

// ---------------------------------------------------------------------------
// IPC: browser UI (toolbar/tab strip)
// ---------------------------------------------------------------------------

function onUi(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    const win = windows.get(event.sender.id);
    if (win) handler(win, ...args);
  });
}

onUi('ui:ready', (win) => win.emit());
onUi('tab:new', (win) => win.newTab());
onUi('tab:close', (win, id) => win.closeTab(id));
onUi('tab:activate', (win, id) => win.activate(id));
onUi('tab:move', (win, id, index) => win.moveTab(id, index));
onUi('nav:go', (win, input) => win.go(String(input)));
onUi('nav:back', (win) => win.active?.wc.navigationHistory.goBack());
onUi('nav:forward', (win) => win.active?.wc.navigationHistory.goForward());
onUi('nav:reload', (win) => win.active?.wc.reload());
onUi('nav:stop', (win) => win.active?.wc.stop());
onUi('nav:home', (win) => win.active?.wc.loadURL(brand.homepage));
onUi('nav:focus-page', (win) => win.active?.wc.focus());
onUi('bookmark:toggle', (win) => toggleBookmark(win));
onUi('adblock:toggle', () => setAdblock(!store.getSettings().adblock));
onUi('menu:open', (win) => popupMainMenu(win));
onUi('update:install', () => updater.install());

// ---------------------------------------------------------------------------
// IPC: internal pages (newtab, bookmarks, history) — only from our scheme
// ---------------------------------------------------------------------------

function onInternal(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const tab = tabs.get(event.sender.id);
    const frame = event.senderFrame;
    if (!tab || !frame || frame.parent || !isInternal(frame.url)) throw new Error('Not allowed');
    return handler(tab, ...args);
  });
}

onInternal('internal:info', (tab) => ({
  name: brand.name,
  private: tab.win.isPrivate,
  searchEngine: store.getSettings().searchEngine,
  blockedTotal: store.getSettings().blockedTotal || 0,
  adblock: store.getSettings().adblock,
  background: backgrounds.source(currentBackground()),
}));
onInternal('internal:bookmarks', () => store.listBookmarks());
onInternal('internal:history', () => store.listHistory());
onInternal('internal:remove-bookmark', (_tab, url) => {
  store.removeBookmark(String(url));
  allWins().forEach((w) => w.emit());
});
onInternal('internal:remove-visit', (_tab, url, time) => store.removeVisit(String(url), Number(time)));
onInternal('internal:clear-history', () => store.clearHistory());
onInternal('internal:navigate', (tab, input) => {
  const url = toUrl(String(input));
  if (url) tab.wc.loadURL(url);
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const urlsFromArgs = (argv) => argv.filter((a) => /^https?:\/\//i.test(a));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const urls = urlsFromArgs(argv);
    const win = focusedWin();
    if (!win) return urls.length ? urls.forEach((url) => new Win({ url })) : new Win();
    urls.forEach((url) => win.newTab(url));
    if (!urls.length) new Win();
    win.bw.focus();
  });

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    store = createStores(userData, brand);
    nativeTheme.themeSource = store.getSettings().appearance || 'system';
    backgrounds = new Backgrounds(brand.backgrounds, path.join(userData, 'backgrounds'));
    backgrounds.cache(backgrounds.find(currentBackground()));
    app.userAgentFallback = cleanUserAgent(app.userAgentFallback);

    adblock = new AdBlock(userData, store.getSettings().adblock);
    let blockedSinceSave = 0;
    adblock.onBlocked = (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tab.blocked++;
      tab.win.emit();
      blockedSinceSave++;
      if (blockedSinceSave >= 20) {
        store.setSetting('blockedTotal', (store.getSettings().blockedTotal || 0) + blockedSinceSave);
        blockedSinceSave = 0;
      }
    };
    app.on('before-quit', () => {
      store.setSetting('blockedTotal', (store.getSettings().blockedTotal || 0) + blockedSinceSave);
      blockedSinceSave = 0;
      store.all.forEach((s) => s.flush());
    });

    buildAppMenu();
    updater.init(() => allWins().forEach((w) => w.emit()));
    const urls = urlsFromArgs(process.argv);
    const win = new Win({ url: urls[0] });
    urls.slice(1).forEach((url) => win.newTab(url, false));
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (windows.size === 0) new Win();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const open = () => (focusedWin() ? focusedWin().newTab(url) : new Win({ url }));
    app.isReady() ? open() : app.whenReady().then(open);
  });
}

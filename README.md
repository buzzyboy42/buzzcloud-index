# BuzzCloud Index

**BuzzCloud Web Browser**

Part of the BuzzCloud ecosystem. A desktop web browser built on Chromium (via Electron). Chromium renders the pages and does the networking. Everything else is this project's own code: the tab strip, toolbar, ad blocker wiring, private windows, bookmarks, history and the internal pages.

## Run it

```bash
npm install
npm start
```

## Build installers

```bash
npm run dist:linux   # AppImage + .deb  → dist/
npm run dist:win     # NSIS installer (run on Windows)
npm run dist:mac     # .dmg (run on macOS)
```

## Features

- **Tabs and navigation.** Tabs with back, forward, reload/stop and home. The address bar takes a URL or a search query. Middle-click closes a tab, and closed tabs can be reopened.
- **Ad and tracker blocking.** Uses Ghostery's engine with EasyList, EasyPrivacy and related lists. It blocks network requests and hides ad elements on the page. The shield in the toolbar shows how many requests were blocked on the current page; click it to turn blocking off or on.
- **Privacy defaults.** Every request sends `Sec-GPC: 1` and `DNT: 1`. Camera, microphone, location, notifications and screen sharing are blocked unless you allow them in a prompt, and that answer lasts until the browser restarts. The user agent is plain Chrome, so the browser can't be fingerprinted as Electron.
- **Private windows.** Each one gets its own in-memory session. Nothing is saved to history, and cookies and storage are deleted when the window closes.
- **Bookmarks and history.** Star a page or press Ctrl+D. Bookmarks show as tiles on the new tab page. There are searchable `buzzcloud://bookmarks` and `buzzcloud://history` pages.
- **Branding.** The name, accent color, search engines and homepage live in `brand.json`. The icon is `build/icon.svg` / `icon.png`.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New tab / window / private window | Ctrl+T / Ctrl+N / Ctrl+Shift+N |
| Close tab / reopen closed tab | Ctrl+W / Ctrl+Shift+T |
| Address bar | Ctrl+L or F6 |
| Back / forward | Alt+← / Alt+→ |
| Reload / hard reload | Ctrl+R or F5 / Ctrl+Shift+R |
| Next / previous tab, tab 1–8, last tab | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+1–8, Ctrl+9 |
| Bookmark page / bookmarks / history | Ctrl+D / Ctrl+Shift+O / Ctrl+H |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 |
| Full screen / dev tools | F11 / F12 |

(On macOS, use Cmd instead of Ctrl.)

## Rebranding

1. Edit `brand.json`: `name`, `accent`, `scheme` (the internal URL scheme, e.g. `buzzcloud://`), `homepage` (it must use the same scheme) and the search engines.
2. Replace `build/icon.svg` and export it to `build/icon.png` at 512×512.
3. Update `name`, `productName`, `build.appId` and `build.productName` in `package.json`.

## How it's put together

```
brand.json               name, colors, search engines
src/main.js              main process: windows, tabs, menus/shortcuts, permissions, IPC
src/adblock.js           Ghostery engine wired into each browsing session
src/store.js             JSON storage for bookmarks, history and settings (in the user-data dir)
src/preload-ui.js        narrow bridge for the toolbar UI
src/preload-internal.js  bridge for buzzcloud:// pages only; the main process re-checks the sender
src/ui/                  tab strip and toolbar (HTML/CSS/JS)
src/pages/               new tab, bookmarks and history pages
```

Each window is a `BrowserWindow` whose own web contents is the toolbar. Each tab is a separate `WebContentsView` placed below the toolbar. Web pages run sandboxed with context isolation and have no access to Node or the browser's IPC.

## Known limitations

- **No DRM video (Netflix, Disney+, …).** Stock Electron ships without Widevine. Use [castLabs' Electron for Content Security](https://github.com/castlabs/electron-releases) to add it.
- **No Chrome Web Store extensions.** Electron supports only part of the extension API.
- **Some Google sign-ins may refuse "embedded" browsers.** Most other sites behave like Chrome.
- **No auto-update or sync yet.** For auto-update, add `electron-updater` and a release feed.

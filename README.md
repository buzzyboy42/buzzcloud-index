# BuzzCloud Index

**BuzzCloud Web Browser**

Part of the BuzzCloud ecosystem. A desktop web browser built on Chromium (via Electron). Chromium renders the pages and does the networking. Everything else is this project's own code: the tab strip, toolbar, ad blocker wiring, private windows, bookmarks, history and the internal pages.

## Run it

```bash
npm install
npm start
```

## Download and install

Get the latest version from the [Releases page](https://github.com/buzzyboy42/buzzcloud-index/releases/latest):

| System | File |
|---|---|
| Windows | `BuzzCloud-Index-Setup-x.y.z.exe`: run it to install |
| macOS | `.dmg`: `arm64` for Apple Silicon, `x64` for Intel |
| Linux | `.AppImage` (make it executable and run it) or `.deb` |

The installers aren't code-signed yet, so on first launch Windows SmartScreen shows **More info → Run anyway**, and macOS needs **right-click → Open**.

## Automatic updates

Installed copies check GitHub Releases at startup and every 4 hours, then download new versions in the background. When an update is ready, the toolbar shows **Restart to update**. If you ignore it, the update installs the next time the browser quits. You can also check by hand under **Settings → Check for Updates…**.

- **Windows and Linux AppImage:** fully automatic.
- **macOS:** Apple only allows auto-update for signed apps. Until the app is signed with an Apple Developer ID, "Check for Updates…" opens the Releases page instead.

## Publishing a new version

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.1.1`) and push to `main`.
2. On GitHub, go to **Actions → Release → Run workflow**.

Alternatively, run `npm version patch && git push --follow-tags` from your computer.

Either way, this starts the **Release** GitHub Action (`.github/workflows/release.yml`). It builds the Windows, macOS and Linux installers on GitHub's servers, uploads them to a draft release, and publishes the release once all three platforms have built. Installed browsers then pick up the update.

To build installers locally instead: `npm run dist:linux`, `npm run dist:win` or `npm run dist:mac`. Each runs on its own operating system and writes to `dist/`.

## Features

- **Tabs and navigation.** Tabs with back, forward, reload/stop and home. The address bar takes a URL or a search query. Middle-click closes a tab, and closed tabs can be reopened.
- **Ad and tracker blocking.** Uses Ghostery's engine with EasyList, EasyPrivacy and related lists. It blocks network requests and hides ad elements on the page. The shield in the toolbar shows how many requests were blocked on the current page; click it to turn blocking off or on.
- **Privacy defaults.** Every request sends `Sec-GPC: 1` and `DNT: 1`. Camera, microphone, location, notifications and screen sharing are blocked unless you allow them in a prompt, and that answer lasts until the browser restarts. The user agent is plain Chrome, so the browser can't be fingerprinted as Electron.
- **Private windows.** Each one gets its own in-memory session. Nothing is saved to history, and cookies and storage are deleted when the window closes.
- **Bookmarks and history.** Star a page or press Ctrl+D. Bookmarks show as tiles on the new tab page. There are searchable `buzzcloud://bookmarks` and `buzzcloud://history` pages.
- **BuzzCloud look.** Follows buzzcloud.win: a Cormorant Garamond serif wordmark, Inter for the interface, spaced-out uppercase labels, and pill-shaped glass controls. The colors come from a storm-slate and cloud palette, with a light "cloud" theme, a dark "storm" theme and a "night" theme for private windows. The new tab page sits on a full-screen cloud sky.

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

## Branding

- **Name, search engines and homepage:** `brand.json`. A two-word name like "BuzzCloud Index" shows as the serif wordmark "BuzzCloud" with "INDEX" underneath.
- **Colors and fonts:** `src/pages/theme.css`. Both the toolbar and the internal pages use it. The fonts are bundled in `src/pages/fonts` (SIL Open Font License), so nothing loads from the internet.
- **New tab background:** put a video at `src/pages/sky.mp4` (H.264) or `src/pages/sky.webm`, and the new tab page plays it muted on a loop. Without one, or when the system asks for reduced motion, it shows the still `src/pages/sky.jpg`.
- **App icon:** edit `build/icon.html`, then run `npm run icon` to regenerate `build/icon.png`.

## How it's put together

```
brand.json               name, colors, search engines
src/main.js              main process: windows, tabs, menus/shortcuts, permissions, IPC
src/adblock.js           Ghostery engine wired into each browsing session
src/updater.js           auto-update from GitHub Releases
src/store.js             JSON storage for bookmarks, history and settings (in the user-data dir)
src/preload-ui.js        narrow bridge for the toolbar UI
src/preload-internal.js  bridge for buzzcloud:// pages only; the main process re-checks the sender
src/ui/                  tab strip and toolbar (HTML/CSS/JS)
src/pages/               new tab, bookmarks and history pages, theme.css, fonts, sky background
```

Each window is a `BrowserWindow` whose own web contents is the toolbar. Each tab is a separate `WebContentsView` placed below the toolbar. Web pages run sandboxed with context isolation and have no access to Node or the browser's IPC.

## Known limitations

- **No DRM video (Netflix, Disney+, …).** Stock Electron ships without Widevine. Use [castLabs' Electron for Content Security](https://github.com/castlabs/electron-releases) to add it.
- **No Chrome Web Store extensions.** Electron supports only part of the extension API.
- **Some Google sign-ins may refuse "embedded" browsers.** Most other sites behave like Chrome.
- **No sync yet.**
- **Unsigned installers.** Code-signing certificates remove the Windows SmartScreen and macOS warnings, and enable Mac auto-update.

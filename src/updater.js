// Auto-update from GitHub Releases (configured under "publish" in package.json).
// Updates download in the background; the toolbar then offers "Restart to update",
// and otherwise the update installs the next time the browser quits.
const { app, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const pkg = require('../package.json');

const CHECK_EVERY = 4 * 60 * 60 * 1000; // 4 hours
// The "build" section isn't packaged with the app, so use "repository" instead.
const REPO_URL = (pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');
const RELEASES_URL = `${REPO_URL}/releases/latest`;

// macOS only installs updates for code-signed apps. Until the app is signed,
// Mac users are pointed to the Releases page instead.
const SUPPORTED = app.isPackaged && process.platform !== 'darwin';

const state = { status: 'idle', version: null }; // idle | checking | downloading | ready | error
let onChange = () => {};
let manualCheck = false;

function set(status, extra = {}) {
  Object.assign(state, { status }, extra);
  onChange(state);
}

function init(listener) {
  onChange = listener;
  if (!SUPPORTED) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => set('checking'));
  autoUpdater.on('update-available', (info) => set('downloading', { version: info.version }));
  autoUpdater.on('update-not-available', () => {
    set('idle');
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({ message: `You're up to date.`, detail: `${app.getName()} ${app.getVersion()} is the latest version.` });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    set('ready', { version: info.version });
    if (manualCheck) {
      manualCheck = false;
      promptRestart();
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('Update check failed:', err.message);
    set('error');
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check for updates.', detail: err.message });
    }
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10 * 1000); // shortly after startup
  setInterval(check, CHECK_EVERY);
}

function checkNow() {
  if (!SUPPORTED) {
    if (!app.isPackaged) {
      dialog.showMessageBox({ message: 'Updates are only checked in the installed app, not when running from source.' });
    } else {
      shell.openExternal(RELEASES_URL);
    }
    return;
  }
  if (state.status === 'ready') return promptRestart();
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

async function promptRestart() {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `${app.getName()} ${state.version} is ready to install.`,
    detail: 'Restart now to update, or it will be installed the next time you quit.',
  });
  if (response === 0) install();
}

function install() {
  if (state.status === 'ready') autoUpdater.quitAndInstall();
}

module.exports = { init, checkNow, install, state };

// Renders build/icon.html to build/icon.png (512×512) with Electron.
// Usage: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512, height: 512, useContentSize: true, frame: false,
    transparent: true, backgroundColor: '#00000000', show: true,
  });
  await win.loadFile(path.join(__dirname, 'icon.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), image.resize({ width: 512, height: 512 }).toPNG());
  app.quit();
});

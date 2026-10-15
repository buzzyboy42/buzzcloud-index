// New tab backgrounds (listed in brand.json). The built-in one ships with the
// app; the others stream from BuzzCloud's drive the first time and are saved
// to the user-data folder, so later new tabs open instantly and offline.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { net } = require('electron');

class Backgrounds {
  constructor(list, dir) {
    this.list = list;
    this.dir = dir;
    this.downloads = new Map(); // id -> Promise
  }

  find(id) {
    return this.list.find((b) => b.id === id) || this.list[0];
  }

  isRemote(bg) {
    return /^https:\/\//.test(bg.src);
  }

  file(bg) {
    return path.join(this.dir, `${bg.id}.mp4`);
  }

  isCached(bg) {
    return fs.existsSync(this.file(bg));
  }

  // What the new tab page should play: a page-relative path for built-in or
  // saved videos, otherwise the remote URL while the copy is being saved.
  source(id) {
    const bg = this.find(id);
    if (!this.isRemote(bg)) return { ...bg, src: bg.src };
    if (this.isCached(bg)) return { ...bg, src: `bg/${bg.id}.mp4` };
    this.cache(bg);
    return bg;
  }

  // Path of a saved video for the internal page server, or null.
  cachedFileFor(id) {
    const bg = this.list.find((b) => b.id === id);
    return bg && this.isRemote(bg) && this.isCached(bg) ? this.file(bg) : null;
  }

  cache(bg) {
    if (!this.isRemote(bg) || this.isCached(bg)) return Promise.resolve();
    if (this.downloads.has(bg.id)) return this.downloads.get(bg.id);
    const job = (async () => {
      const tmp = `${this.file(bg)}.part`;
      try {
        await fs.promises.mkdir(this.dir, { recursive: true });
        const res = await net.fetch(bg.src);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
        await fs.promises.rename(tmp, this.file(bg));
      } catch (err) {
        console.error(`Couldn't save the "${bg.name}" background:`, err.message);
        await fs.promises.rm(tmp, { force: true });
      } finally {
        this.downloads.delete(bg.id);
      }
    })();
    this.downloads.set(bg.id, job);
    return job;
  }
}

module.exports = { Backgrounds };

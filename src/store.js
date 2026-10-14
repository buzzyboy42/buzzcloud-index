// Tiny JSON-file persistence for bookmarks, history and settings.
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dir, name, fallback) {
    this.file = path.join(dir, `${name}.json`);
    this.timer = null;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = structuredClone(fallback);
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

const HISTORY_LIMIT = 5000;

function createStores(dir, brand) {
  const bookmarks = new JsonStore(dir, 'bookmarks', []);
  const history = new JsonStore(dir, 'history', []);
  const settings = new JsonStore(dir, 'settings', {
    searchEngine: brand.defaultSearchEngine,
    adblock: true,
  });

  return {
    all: [bookmarks, history, settings],

    // Bookmarks: [{ url, title, added }]
    listBookmarks: () => bookmarks.data,
    isBookmarked: (url) => bookmarks.data.some((b) => b.url === url),
    toggleBookmark(url, title) {
      const i = bookmarks.data.findIndex((b) => b.url === url);
      if (i >= 0) bookmarks.data.splice(i, 1);
      else bookmarks.data.unshift({ url, title: title || url, added: Date.now() });
      bookmarks.save();
      return i < 0;
    },
    removeBookmark(url) {
      bookmarks.data = bookmarks.data.filter((b) => b.url !== url);
      bookmarks.save();
    },

    // History: newest first, [{ url, title, time }]
    listHistory: () => history.data,
    addVisit(url, title) {
      const last = history.data[0];
      if (last && last.url === url) {
        last.title = title || last.title;
        last.time = Date.now();
      } else {
        history.data.unshift({ url, title: title || url, time: Date.now() });
        if (history.data.length > HISTORY_LIMIT) history.data.length = HISTORY_LIMIT;
      }
      history.save();
    },
    updateTitle(url, title) {
      const last = history.data.find((h) => h.url === url);
      if (last && title) {
        last.title = title;
        history.save();
      }
    },
    removeVisit(url, time) {
      history.data = history.data.filter((h) => !(h.url === url && h.time === time));
      history.save();
    },
    clearHistory() {
      history.data = [];
      history.save();
    },

    getSettings: () => settings.data,
    setSetting(key, value) {
      settings.data[key] = value;
      settings.save();
    },
  };
}

module.exports = { createStores };

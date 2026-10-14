// Stand-ins for the Electron bridges (window.browser / window.internal) so the
// browser's real pages render inside the launch video with sample data.
(() => {
  const isPrivate = new URLSearchParams(location.search).get('private') === '1';
  const now = Date.now();
  const min = 60 * 1000;

  window.browser = {
    send() {},
    onState(cb) { window.__setState = cb; },
    onFocusAddress() {},
  };

  const bookmarks = [
    { url: 'https://buzzcloud.win/', title: 'BuzzCloud' },
    { url: 'https://en.wikipedia.org/', title: 'Wikipedia' },
    { url: 'https://github.com/', title: 'GitHub' },
    { url: 'https://www.openstreetmap.org/', title: 'Maps' },
    { url: 'https://www.youtube.com/', title: 'YouTube' },
  ].map((b, i) => ({ ...b, added: now - i * 864e5 }));

  const history = [
    { url: 'https://dailycurrent.example/world/clean-energy', title: 'Clean energy passes a milestone — The Daily Current', time: now - 4 * min },
    { url: 'https://buzzcloud.win/', title: 'BuzzCloud — Computing Service', time: now - 22 * min },
    { url: 'https://en.wikipedia.org/wiki/Cloud', title: 'Cloud — Wikipedia', time: now - 47 * min },
    { url: 'https://www.openstreetmap.org/', title: 'OpenStreetMap', time: now - 95 * min },
    { url: 'https://github.com/buzzyboy42/buzzcloud-index', title: 'buzzcloud-index — GitHub', time: now - 140 * min },
  ];

  const ok = async () => {};
  window.internal = {
    info: async () => ({ name: 'BuzzCloud Index', private: isPrivate, searchEngine: 'DuckDuckGo', blockedTotal: 12480, adblock: true }),
    bookmarks: async () => bookmarks,
    history: async () => history,
    removeBookmark: ok, removeVisit: ok, clearHistory: ok, navigate: ok,
  };

  document.addEventListener('DOMContentLoaded', () => {
    // The new tab page's own background video is replaced by its still frame.
    document.getElementById('bg')?.remove();
    const style = document.createElement('style');
    style.textContent = `
      #address-form.focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
      * { caret-color: transparent; }
      .logo, .subtitle, .search, .tiles { animation: none !important; opacity: 1 !important; transform: none !important; }`;
    document.head.append(style);
  });
})();

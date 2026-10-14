// Background video: the first of these files that exists is used; with none
// (or with reduced motion requested) the still sky.jpg stays.
function startVideo() {
  const video = document.getElementById('bg');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return video.remove();
  const sources = ['sky.mp4', 'sky.webm'];
  const next = () => {
    const src = sources.shift();
    if (!src) return video.remove();
    video.src = src;
    video.play().catch(() => {});
  };
  video.addEventListener('error', next);
  video.addEventListener('playing', () => video.classList.add('playing'), { once: true });
  next();
}

// Type-to-search: there's no need to click the search box first. Any ordinary
// key pressed while the page has focus starts typing there; shortcuts
// (Ctrl/Cmd/Alt combinations) are left alone.
function typeToSearch() {
  const q = document.getElementById('q');
  q.focus();
  addEventListener('focus', () => q.focus());
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || document.activeElement === q) return;
    const altGr = e.getModifierState?.('AltGraph');
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;
    if (e.key.length !== 1 || (e.key === ' ' && !q.value)) return;
    q.focus(); // the key press itself then lands in the search box
  }, true);
  document.addEventListener('paste', (e) => {
    if (document.activeElement === q) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    e.preventDefault();
    q.focus();
    q.setRangeText(text, q.selectionStart, q.selectionEnd, 'end');
  });
}

(async () => {
  startVideo();
  typeToSearch();
  const info = await applyTheme();
  // "BuzzCloud Index" -> wordmark "BuzzCloud" over a spaced-out "INDEX" line,
  // echoing "BuzzCloud / COMPUTING SERVICE" on buzzcloud.win.
  const words = info.name.split(' ');
  document.getElementById('logo').textContent = words[0];
  document.getElementById('subtitle').textContent =
    [words.slice(1).join(' ') || 'Web Browser', info.private ? 'Private' : ''].filter(Boolean).join(' · ');
  document.getElementById('q').placeholder = `Start typing to search ${info.searchEngine}…`;

  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (q) window.internal.navigate(q);
  });

  if (info.private) {
    document.querySelector('.home').append(el('p', {
      className: 'private-note',
      textContent: 'Nothing from this window is saved to your history. Cookies and site data are deleted when you close it.',
    }));
  }

  const bookmarks = (await window.internal.bookmarks()).slice(0, 12);
  const tiles = document.getElementById('tiles');
  for (const b of bookmarks) {
    const badge = el('span', { className: 'badge' });
    const icon = faviconFor(b.url);
    const letter = (hostOf(b.url)[0] || '?').toUpperCase();
    if (icon) {
      const img = el('img', { src: icon, alt: '' });
      img.onerror = () => badge.replaceChildren(letter);
      badge.append(img);
    } else badge.append(letter);
    tiles.append(el('a', { className: 'tile', href: b.url, title: b.title },
      badge, el('span', { className: 'name', textContent: b.title || hostOf(b.url) })));
  }

  if (info.adblock && info.blockedTotal > 0) {
    document.getElementById('stats').append(
      `${info.blockedTotal.toLocaleString()} ads & trackers blocked`,
    );
  }
})();

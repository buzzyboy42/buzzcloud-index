// Background video: the one chosen under Settings → New Tab Background, falling
// back to the built-in clouds if it can't load. With reduced motion requested,
// the still sky.jpg stays.
function startVideo(background) {
  const video = document.getElementById('bg');
  if (!video) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return video.remove();
  const custom = background && background.src !== 'sky.mp4';
  if (custom) {
    // Don't flash the clouds' still frame before a different video appears.
    document.querySelector('.home').classList.add('custom-bg');
    if (background.filter) video.style.filter = background.filter;
  }
  const sources = [...new Set([background?.src, 'sky.mp4'].filter(Boolean))];
  const next = () => {
    const src = sources.shift();
    if (!src) return video.remove();
    if (src === 'sky.mp4') {
      video.style.filter = '';
      document.querySelector('.home').classList.remove('custom-bg');
    }
    video.loop = true; // loopBetween() takes over when there are fades to skip
    video.src = src;
  };
  // Before it starts, cut any fade-in/fade-out off the loop (fades.js), or use
  // the trim points given in brand.json.
  video.addEventListener('loadeddata', async () => {
    const usingChosen = !(custom && video.currentSrc.endsWith('/sky.mp4')); // not the fallback
    const trim = usingChosen && background?.trim
      ? { start: background.trim[0], end: background.trim[1] }
      : await BackgroundFades.findFades(video.currentSrc);
    if (trim) BackgroundFades.loopBetween(video, trim);
    video.play().catch(() => {});
  });
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
  typeToSearch();
  const info = await applyTheme();
  startVideo(info.background);
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

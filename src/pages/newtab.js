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

(async () => {
  startVideo();
  const info = await applyTheme();
  // "BuzzCloud Index" -> wordmark "BuzzCloud" over a spaced-out "INDEX" line,
  // echoing "BuzzCloud / COMPUTING SERVICE" on buzzcloud.win.
  const words = info.name.split(' ');
  document.getElementById('logo').textContent = words[0];
  document.getElementById('subtitle').textContent =
    [words.slice(1).join(' ') || 'Web Browser', info.private ? 'Private' : ''].filter(Boolean).join(' · ');
  document.getElementById('q').placeholder = `Search with ${info.searchEngine} or enter address`;

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

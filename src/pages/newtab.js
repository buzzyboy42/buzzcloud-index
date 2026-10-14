(async () => {
  const info = await applyTheme();
  const name = info.name;
  const $logo = document.getElementById('logo');
  // Accent the last word of multi-word names ("BuzzCloud Index"), else the last letter.
  const split = name.includes(' ') ? name.lastIndexOf(' ') + 1 : name.length - 1;
  $logo.append(name.slice(0, split), el('span', { textContent: name.slice(split) }));
  document.getElementById('tagline').textContent = info.private
    ? 'Private window'
    : 'Fast. Private. Yours.';
  document.getElementById('q').placeholder = `Search with ${info.searchEngine} or enter address`;

  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (q) window.internal.navigate(q);
  });

  if (info.private) {
    document.querySelector('.home').append(el('p', {
      className: 'private-note',
      textContent: 'Pages you open in this window won’t be saved to your history, and cookies and site data are deleted when you close it.',
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
      el('b', { textContent: info.blockedTotal.toLocaleString() }),
      ' ads & trackers blocked so far',
    );
  }
})();

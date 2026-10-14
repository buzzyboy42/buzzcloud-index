const list = document.getElementById('list');
const filter = document.getElementById('filter');
let bookmarks = [];

function render() {
  const q = filter.value.trim().toLowerCase();
  const shown = bookmarks.filter((b) => !q || `${b.title} ${b.url}`.toLowerCase().includes(q));
  if (!shown.length) {
    list.replaceChildren(el('p', { className: 'empty', textContent: bookmarks.length
      ? 'No bookmarks match your search.'
      : 'No bookmarks yet. Press Ctrl+D or click the star in the address bar to add one.' }));
    return;
  }
  const box = el('div', { className: 'list' });
  for (const b of shown) {
    const remove = el('button', { className: 'remove', textContent: 'Remove', title: 'Remove bookmark' });
    remove.addEventListener('click', async (e) => {
      e.preventDefault();
      await window.internal.removeBookmark(b.url);
      load();
    });
    const icon = el('img', { src: faviconFor(b.url) || '', alt: '' });
    icon.onerror = () => (icon.style.visibility = 'hidden');
    box.append(el('a', { className: 'row', href: b.url },
      icon,
      el('span', { className: 'text' },
        el('span', { className: 'title', textContent: b.title || b.url }),
        el('span', { className: 'url', textContent: b.url })),
      remove));
  }
  list.replaceChildren(box);
}

async function load() {
  bookmarks = await window.internal.bookmarks();
  render();
}

filter.addEventListener('input', render);
document.addEventListener('visibilitychange', () => !document.hidden && load());
applyTheme();
load();

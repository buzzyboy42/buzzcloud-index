const list = document.getElementById('list');
const filter = document.getElementById('filter');
const LIMIT = 500;
let history = [];

const dayLabel = (time) => {
  const d = new Date(time);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

function render() {
  const q = filter.value.trim().toLowerCase();
  const shown = history.filter((h) => !q || `${h.title} ${h.url}`.toLowerCase().includes(q)).slice(0, LIMIT);
  if (!shown.length) {
    list.replaceChildren(el('p', { className: 'empty', textContent: history.length
      ? 'No pages match your search.' : 'Your browsing history is empty.' }));
    return;
  }
  const out = [];
  let box = null;
  let day = null;
  for (const h of shown) {
    const label = dayLabel(h.time);
    if (label !== day) {
      day = label;
      box = el('div', { className: 'list' });
      out.push(el('div', { className: 'day', textContent: label }), box);
    }
    const remove = el('button', { className: 'remove', textContent: 'Remove', title: 'Remove from history' });
    remove.addEventListener('click', async (e) => {
      e.preventDefault();
      await window.internal.removeVisit(h.url, h.time);
      load();
    });
    const icon = el('img', { src: faviconFor(h.url) || '', alt: '' });
    icon.onerror = () => (icon.style.visibility = 'hidden');
    box.append(el('a', { className: 'row', href: h.url },
      el('span', { className: 'time', textContent: new Date(h.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }),
      icon,
      el('span', { className: 'text' },
        el('span', { className: 'title', textContent: h.title || h.url }),
        el('span', { className: 'url', textContent: h.url })),
      remove));
  }
  list.replaceChildren(...out);
}

async function load() {
  history = await window.internal.history();
  render();
}

filter.addEventListener('input', render);
document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Clear all browsing history?')) return;
  await window.internal.clearHistory();
  load();
});
document.addEventListener('visibilitychange', () => !document.hidden && load());
applyTheme();
load();

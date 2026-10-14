const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const address = $('address');
let state = null;
let editing = false;
let lastActiveId = null;

const closeIcon = '<svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></svg>';

function renderTabs() {
  const existing = new Map([...tabsEl.children].map((el) => [Number(el.dataset.id), el]));
  const narrow = state.tabs.length * 120 > tabsEl.parentElement.clientWidth - 60;

  state.tabs.forEach((tab, i) => {
    let el = existing.get(tab.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tab';
      el.dataset.id = tab.id;
      el.innerHTML = `<span class="favicon"><img alt=""></span><span class="title"></span>
        <button class="close icon" title="Close tab (Ctrl+W)">${closeIcon}</button>`;
      el.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !e.target.closest('.close')) browser.send('tab:activate', tab.id);
      });
      el.addEventListener('auxclick', (e) => e.button === 1 && browser.send('tab:close', tab.id));
      el.querySelector('.close').addEventListener('click', () => browser.send('tab:close', tab.id));
    }
    existing.delete(tab.id);
    if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);

    el.classList.toggle('active', tab.id === state.activeId);
    el.classList.toggle('loading', tab.loading);
    el.classList.toggle('narrow', narrow && tab.id !== state.activeId);
    el.title = tab.title;
    el.querySelector('.title').textContent = tab.title || 'New Tab';
    const fav = el.querySelector('.favicon');
    const favUrl = tab.favicon && /^(https?|data):/.test(tab.favicon) ? tab.favicon : '';
    if (fav.dataset.src !== favUrl) {
      fav.dataset.src = favUrl;
      fav.classList.remove('has');
      const img = fav.firstChild;
      img.onload = () => fav.dataset.src === favUrl && fav.classList.add('has');
      img.onerror = () => fav.classList.remove('has');
      if (favUrl) img.src = favUrl;
      else img.removeAttribute('src');
    }
  });
  existing.forEach((el) => el.remove());
}

function renderToolbar() {
  const a = state.active || {};
  $('back').disabled = !a.canGoBack;
  $('forward').disabled = !a.canGoForward;
  $('reload').classList.toggle('loading', !!a.loading);
  $('reload').title = a.loading ? 'Stop' : 'Reload (Ctrl+R)';

  const bm = $('bookmark');
  bm.disabled = !a.bookmarkable;
  bm.classList.toggle('on', !!a.bookmarked);
  bm.title = a.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';

  const icon = $('site-icon');
  icon.className = !a.url ? 'search' : a.secure ? 'secure' : 'insecure';
  icon.title = !a.url ? '' : a.secure ? 'Connection is secure' : 'Connection is not secure';

  const shield = $('shield');
  shield.classList.toggle('off', !state.adblock);
  $('blocked-count').textContent = state.adblock && a.blocked ? String(a.blocked) : '';
  shield.title = state.adblock
    ? `Blocked ${a.blocked || 0} ads & trackers on this page. Click to turn blocking off.`
    : 'Ad & tracker blocking is off. Click to turn it on.';

  const switched = state.activeId !== lastActiveId;
  lastActiveId = state.activeId;
  if (!editing || switched) {
    address.value = a.url || '';
    if (switched && editing) address.select();
  }
}

browser.onState((s) => {
  state = s;
  document.body.classList.toggle('private', s.private);
  document.documentElement.style.setProperty('--accent', s.brand.accent);
  renderTabs();
  renderToolbar();
});

browser.onFocusAddress(() => {
  address.focus();
  address.select();
});

address.addEventListener('focus', () => {
  editing = true;
  requestAnimationFrame(() => address.select());
});
address.addEventListener('blur', () => {
  editing = false;
  if (state) renderToolbar();
});
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    address.value = state?.active?.url || '';
    browser.send('nav:focus-page');
  }
});
$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!address.value.trim()) return;
  editing = false;
  browser.send('nav:go', address.value);
});

$('new-tab').addEventListener('click', () => browser.send('tab:new'));
$('back').addEventListener('click', () => browser.send('nav:back'));
$('forward').addEventListener('click', () => browser.send('nav:forward'));
$('reload').addEventListener('click', () =>
  browser.send(state?.active?.loading ? 'nav:stop' : 'nav:reload'));
$('home').addEventListener('click', () => browser.send('nav:home'));
$('bookmark').addEventListener('click', () => browser.send('bookmark:toggle'));
$('shield').addEventListener('click', () => browser.send('adblock:toggle'));
$('menu').addEventListener('click', () => browser.send('menu:open'));
window.addEventListener('resize', () => state && renderTabs());

browser.send('ui:ready');

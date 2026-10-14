const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const address = $('address');
let state = null;
let editing = false;
let lastActiveId = null;

const closeIcon = '<svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></svg>';

// --- Dragging tabs to reorder them ----------------------------------------
let drag = null; // { id, el, startX, moved, index, target, slots }

function startDrag(e, id, el) {
  const tabs = [...tabsEl.children];
  drag = {
    id, el, startX: e.clientX, moved: false,
    index: tabs.indexOf(el), target: tabs.indexOf(el),
    slots: tabs.map((t) => { const r = t.getBoundingClientRect(); return { el: t, left: r.left, width: r.width }; }),
  };
  el.setPointerCapture(e.pointerId);
}

function moveDrag(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  if (!drag.moved && Math.abs(dx) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.el.classList.add('dragging');
    tabsEl.classList.add('reordering');
  }
  const first = drag.slots[0];
  const last = drag.slots[drag.slots.length - 1];
  const me = drag.slots[drag.index];
  const offset = Math.max(first.left - me.left, Math.min(last.left + last.width - (me.left + me.width), dx));
  drag.el.style.transform = `translateX(${offset}px)`;

  // Where would the dragged tab land? Count the other tabs whose centre it has passed.
  const center = me.left + offset + me.width / 2;
  let target = 0;
  drag.slots.forEach((slot, i) => {
    if (i !== drag.index && slot.left + slot.width / 2 < center) target++;
  });
  drag.target = target;

  // Slide the tabs in between out of the way.
  const gap = 2;
  drag.slots.forEach((slot, i) => {
    if (i === drag.index) return;
    let shift = 0;
    if (i > drag.index && i <= target) shift = -(me.width + gap);
    if (i < drag.index && i >= target) shift = me.width + gap;
    slot.el.style.transform = shift ? `translateX(${shift}px)` : '';
  });
}

function endDrag() {
  if (!drag) return;
  const { id, el, moved, index, target } = drag;
  drag = null;
  if (!moved) return;
  // Put the element in its new place right away so nothing jumps, then tell the browser.
  const others = [...tabsEl.children].filter((t) => t !== el);
  tabsEl.insertBefore(el, others[target] || null);
  tabsEl.classList.remove('reordering');
  for (const t of tabsEl.children) t.style.transform = '';
  el.classList.remove('dragging');
  if (target !== index) browser.send('tab:move', id, target);
  if (state) renderTabs();
}

function renderTabs() {
  if (drag?.moved) return; // finish the drag first; endDrag() re-renders
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
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.close')) return;
        browser.send('tab:activate', tab.id);
        startDrag(e, tab.id, el);
      });
      el.addEventListener('pointermove', moveDrag);
      el.addEventListener('pointerup', endDrag);
      el.addEventListener('pointercancel', endDrag);
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

  const update = $('update');
  update.hidden = !state.updateReady;
  update.title = state.updateReady ? `Version ${state.updateReady} is ready. Restart to install it.` : '';

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
  // "BuzzCloud Index" -> serif wordmark "BuzzCloud", like the site header
  $('wordmark').textContent = s.brand.name.split(' ')[0];
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
$('update').addEventListener('click', () => browser.send('update:install'));
window.addEventListener('resize', () => state && renderTabs());

browser.send('ui:ready');

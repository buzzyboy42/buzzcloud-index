// Shared helpers for internal pages.
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function faviconFor(url) {
  try {
    const { protocol, host } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    return `${protocol}//${host}/favicon.ico`;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function applyTheme() {
  const info = await window.internal.info();
  document.documentElement.style.setProperty('--accent', info.accent);
  document.body.classList.toggle('private', info.private);
  return info;
}

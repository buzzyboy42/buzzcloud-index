// Trims fade-ins and fade-outs off looping background videos.
//
// findFades() samples the brightness of the first and last few seconds of a
// video. If the very start (or end) is much darker or brighter than the middle
// of the clip, it finds where the fade finishes and returns { start, end } so
// the loop can skip it. Clips without fades come back untouched.
// loopBetween() then plays a <video> only between those two points.
(() => {
  const once = (el, ok, fail = 'error', ms = 15000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      el.addEventListener(ok, () => { clearTimeout(t); resolve(); }, { once: true });
      el.addEventListener(fail, () => { clearTimeout(t); reject(new Error(fail)); }, { once: true });
    });

  async function measure(src, crossOrigin) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    if (crossOrigin) v.crossOrigin = 'anonymous';
    v.src = src;
    await once(v, 'loadeddata');
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const brightness = async (t) => {
      v.currentTime = t;
      await once(v, 'seeked');
      g.drawImage(v, 0, 0, 32, 18);
      const d = g.getImageData(0, 0, 32, 18).data; // throws if the video is cross-origin without CORS
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4);
    };

    const dur = v.duration;
    if (!Number.isFinite(dur) || dur < 3) return { start: 0, end: dur };
    const middle = [await brightness(dur * 0.35), await brightness(dur * 0.5), await brightness(dur * 0.65)].sort((a, b) => a - b)[1];
    const off = (l) => Math.abs(l - middle) / Math.max(middle, 8);
    const span = Math.min(5, dur / 4);
    const STEP = 0.2;
    const MARGIN = 0.25; // a little past the point where it looks normal again

    let start = 0;
    if (off(await brightness(0)) > 0.35) {
      for (let t = STEP; t <= span; t += STEP) {
        if (off(await brightness(t)) < 0.12) { start = Math.min(t + MARGIN, span); break; }
      }
    }
    let end = dur;
    if (off(await brightness(Math.max(0, dur - 0.05))) > 0.35) {
      for (let t = dur - STEP; t >= dur - span; t -= STEP) {
        if (off(await brightness(t)) < 0.12) { end = Math.max(t - MARGIN, dur - span); break; }
      }
    }
    v.removeAttribute('src');
    v.load();
    return { start: +start.toFixed(2), end: +end.toFixed(2) };
  }

  // Cached per video, so the measuring only happens once.
  async function findFades(src, { crossOrigin = false } = {}) {
    const key = `fades:${src}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved) return saved;
    } catch {}
    try {
      const result = await measure(src, crossOrigin);
      try { localStorage.setItem(key, JSON.stringify(result)); } catch {}
      return result;
    } catch {
      return null; // can't read the frames (e.g. no CORS): play it as it is
    }
  }

  // Loop `video` between start and end instead of over the whole file.
  function loopBetween(video, { start = 0, end = Infinity } = {}) {
    const untrimmed = !(start > 0) && !(end < (video.duration || Infinity) - 0.1);
    if (untrimmed) return; // nothing to skip: keep the normal loop
    video.loop = false;
    const jumpBack = () => {
      video.currentTime = start;
      video.play().catch(() => {});
    };
    if (video.currentTime < start) video.currentTime = start;
    video.addEventListener('ended', jumpBack);
    if ('requestVideoFrameCallback' in video) {
      const check = (_now, frame) => {
        if (frame.mediaTime >= end - 0.04) jumpBack();
        video.requestVideoFrameCallback(check);
      };
      video.requestVideoFrameCallback(check);
    } else {
      video.addEventListener('timeupdate', () => { if (video.currentTime >= end - 0.25) jumpBack(); });
    }
  }

  window.BackgroundFades = { findFades, loopBetween };
})();

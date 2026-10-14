// Renders the launch video: draws every frame of launch-video/index.html with
// Electron, composites it over the cloud footage and a generated ambient
// soundtrack with ffmpeg, and writes website/launch.mp4 (+ a poster image).
//
//   npm run video                    full render (needs ffmpeg on PATH)
//   STILLS=1,8.5,20 npm run video    just a few frames, as PNGs, for checking
const { app, BrowserWindow } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKY = path.join(ROOT, 'src', 'pages', 'sky.mp4');
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, 'website');
const W = 1920;
const H = 1080;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// A slow, breathing pad: two soft chords (A major 9 and F# minor 9) that
// cross-fade every 8 seconds, slightly detuned left/right for width.
function soundtrack(duration, file) {
  const chordA = [110, 164.81, 277.18, 415.3, 493.88];
  const chordB = [92.5, 138.59, 220, 329.63, 415.3];
  const voice = (freqs, detune) =>
    freqs.map((f) => `sin(2*PI*${f}*t)+0.6*sin(2*PI*${(f * detune).toFixed(3)}*t)+0.12*sin(4*PI*${f}*t)`).join('+');
  const channel = (detune) =>
    `0.034*(0.78+0.22*sin(2*PI*t/7))*((0.5+0.5*cos(2*PI*t/16))*(${voice(chordA, detune)})+(0.5-0.5*cos(2*PI*t/16))*(${voice(chordB, detune)}))`;
  const exprs = `${channel(1.004)}|${channel(0.996)}`;
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${exprs}':s=48000:d=${duration}`,
    '-af', [
      'lowpass=f=1600',
      'aecho=0.8:0.55:220|430:0.32|0.2',
      'afade=t=in:d=3',
      `afade=t=out:st=${duration - 4}:d=4`,
      'volume=10dB',
      'alimiter=limit=0.8',
    ].join(','),
    file,
  ], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed to generate the soundtrack');
}

function waitDrain(stream) {
  return new Promise((resolve) => stream.once('drain', resolve));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, frame: false, show: true,
    transparent: true, backgroundColor: '#00000000', enableLargerThanScreen: true,
    webPreferences: { webSecurity: false, backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  const { fps, duration } = await win.webContents.executeJavaScript('window.ready()');

  const capture = async (t) => {
    await win.webContents.executeJavaScript(`render(${t})`);
    // The capture shows the last presented frame, so let one more frame present.
    await win.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 10))))');
    let img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    const size = img.getSize();
    if (size.width !== W || size.height !== H) img = img.resize({ width: W, height: H });
    return img;
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (process.env.STILLS) {
    // Quick check: composite single frames over the matching video frame.
    for (const t of process.env.STILLS.split(',').map(Number)) {
      const overlay = path.join(OUT_DIR, `still-${t}-overlay.png`);
      fs.writeFileSync(overlay, (await capture(t)).toPNG());
      spawnSync('ffmpeg', [
        '-v', 'error', '-y', '-ss', String(t % 55), '-i', SKY, '-i', overlay,
        '-filter_complex', `[0:v]scale=${W}:${H}[bg];[bg][1:v]overlay=format=auto`,
        '-frames:v', '1', path.join(OUT_DIR, `still-${t}.png`),
      ], { stdio: 'inherit' });
      fs.unlinkSync(overlay);
      console.log(`still ${t}s`);
    }
    app.quit();
    return;
  }

  const audio = path.join(OUT_DIR, 'launch-audio.wav');
  soundtrack(duration, audio);

  const out = path.join(OUT_DIR, 'launch.mp4');
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-y',
    '-stream_loop', '-1', '-i', SKY,
    '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`, '-framerate', String(fps), '-i', '-',
    '-i', audio,
    '-filter_complex',
    `[0:v]fps=${fps},scale=${W}:${H},setpts=PTS-STARTPTS[bg];` +
    `[bg][1:v]overlay=format=auto:alpha=premultiplied:shortest=1,` +
    `fade=t=in:d=1,fade=t=out:st=${duration - 1.2}:d=1.2,format=yuv420p[v]`,
    '-map', '[v]', '-map', '2:a', '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const frames = Math.round(fps * duration);
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    const img = await capture(f / fps);
    if (!ff.stdin.write(img.toBitmap())) await waitDrain(ff.stdin);
    if (f % fps === 0) {
      const secs = (Date.now() - started) / 1000;
      console.log(`frame ${f}/${frames} (${Math.round((f / frames) * 100)}%, ${secs.toFixed(0)}s)`);
    }
  }
  ff.stdin.end();
  await new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  fs.unlinkSync(audio);

  // Poster for the landing page: the end card.
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(duration - 3), '-i', out, '-frames:v', '1', '-q:v', '3',
    path.join(OUT_DIR, 'launch-poster.jpg')], { stdio: 'inherit' });
  console.log(`Wrote ${out}`);
  app.quit();
});

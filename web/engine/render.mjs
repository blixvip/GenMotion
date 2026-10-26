// Canvas renderer. drawFrame() is a pure function of (storyboard, time): preview and export
// call the same code, so what you see is exactly what gets encoded, frame for frame.
import { timeline, size } from './storyboard.mjs';
import { LAYER_DRAW } from './layers.mjs';
import { clamp01, ease, rgba } from './ease.mjs';

export { rgba };

export function createRenderer(canvas, { image = () => null } = {}) {
  const ctx = canvas.getContext('2d');
  const layersA = document.createElement('canvas'), layersB = document.createElement('canvas');
  const grain = makeGrain();

  function sceneInto(target, sb, span, t, W, H) {
    if (target.width !== W || target.height !== H) { target.width = W; target.height = H; }
    const c = target.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
    const local = t - span.start;
    const env = { ctx: c, W, H, u: Math.min(W, H) / 1080, sb, scene: span.scene, t: local, style: sb.style, image };
    drawBackground(env);
    for (const layer of span.scene.layers) {
      const lt = local - layer.start;
      if (lt < 0 || lt > layer.duration) continue;
      const draw = LAYER_DRAW[layer.type];
      if (!draw) continue;
      // Layers that stop before the scene ends fade out over their last 0.35 s.
      const tail = layer.start + layer.duration < span.scene.duration - 0.15 ? clamp01((layer.duration - lt) / 0.35) : 1;
      c.save();
      c.globalAlpha = tail;
      draw({ ...env, layer, lt, d: layer.duration, out: tail });
      c.restore();
    }
    return target;
  }

  function draw(sb, t) {
    const { width: W, height: H } = size(sb);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const { spans, duration } = timeline(sb);
    t = Math.max(0, Math.min(duration - 1e-4, t));
    let i = spans.findIndex(s => t >= s.start && t < s.end);
    if (i < 0) i = spans.length - 1;
    // If the next scene has already started, we are inside its transition.
    const next = spans[i + 1];
    const inTransition = next && t >= next.start;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.fillStyle = sb.style.palette.bg; ctx.fillRect(0, 0, W, H);
    if (!inTransition) {
      ctx.drawImage(sceneInto(layersA, sb, spans[i], t, W, H), 0, 0);
    } else {
      const a = sceneInto(layersA, sb, spans[i], t, W, H);
      const b = sceneInto(layersB, sb, next, t, W, H);
      transition(ctx, next.scene.transition.type, a, b, clamp01((t - next.start) / next.overlap), W, H, sb.style.palette);
    }
    post(ctx, sb, t, W, H, grain);
    return { duration, scene: inTransition ? i + 1 : i };
  }

  return { draw, canvas };
}

function drawBackground(env) {
  const { ctx, W, H, scene, style, t, image } = env;
  const pal = style.palette;
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
  const img = scene.background === 'image' && scene.image.src ? image(scene.image.src) : null;
  if (img) {
    drawCamera(ctx, img, scene, t, W, H);
    // Dim: a flat wash plus a stronger floor so bottom text always reads.
    if (scene.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${scene.dim * 0.55})`; ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${scene.dim * 0.9})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    return;
  }
  if (scene.background === 'solid') return;
  if (scene.background === 'grid') return drawGrid(env);
  drawGradient(env);
}

function drawCamera(ctx, img, scene, t, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const p = ease.inOutSine(clamp01(t / scene.duration));
  const a = scene.camera.amount;
  let s = 1.02, x = 0, y = 0;
  const travel = 0.06 * a;
  switch (scene.camera.move) {
    case 'push': s = 1.03 + 0.2 * a * p; break;
    case 'pull': s = 1.03 + 0.2 * a * (1 - p); break;
    case 'pan-left': s = 1.08 + travel; x = travel * (0.5 - p) * 2; break;
    case 'pan-right': s = 1.08 + travel; x = -travel * (0.5 - p) * 2; break;
    case 'rise': s = 1.08 + travel; y = travel * (0.5 - p) * 2; break;
    case 'fall': s = 1.08 + travel; y = -travel * (0.5 - p) * 2; break;
    case 'drift': s = 1.06 + 0.08 * a * p; x = travel * 0.6 * (0.5 - p); y = travel * 0.4 * (p - 0.5); break;
    default: s = 1.02;
  }
  const cover = Math.max(W / iw, H / ih) * s;
  const dw = iw * cover, dh = ih * cover;
  ctx.drawImage(img, (W - dw) / 2 + x * W, (H - dh) / 2 + y * H, dw, dh);
}

function drawGradient({ ctx, W, H, t, style, scene }) {
  const pal = style.palette;
  const seed = hash(scene.id);
  const blobs = [[pal.accent, 0.55], [pal.ink, 0.10], [pal.accent, 0.30]];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  blobs.forEach(([c, a], k) => {
    const ph = seed % 97 / 97 * 6.28 + k * 2.1;
    const cx = W * (0.5 + 0.32 * Math.cos(ph + t * 0.25 * (k + 1) * 0.6));
    const cy = H * (0.5 + 0.28 * Math.sin(ph * 1.3 + t * 0.2 * (k + 1) * 0.6));
    const r = Math.max(W, H) * (0.45 + 0.1 * k);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(c, a * 0.55)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  });
  ctx.restore();
}

function drawGrid({ ctx, W, H, t, style, u }) {
  const step = 80 * u, off = (t * 12 * u) % step;
  ctx.save();
  ctx.strokeStyle = rgba(style.palette.ink, 0.08); ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  for (let x = -step + off; x < W + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = -step + off; y < H + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, rgba(style.palette.bg, 0)); g.addColorStop(1, rgba(style.palette.bg, 1));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function transition(ctx, type, a, b, p, W, H, pal) {
  const e = ease.inOutCubic(p);
  switch (type) {
    case 'dip': case 'flash': {
      const tone = type === 'flash' ? '#ffffff' : '#000000';
      ctx.drawImage(p < 0.5 ? a : b, 0, 0);
      ctx.fillStyle = tone; ctx.globalAlpha = type === 'flash' ? Math.pow(1 - Math.abs(p - 0.5) * 2, 1.6) : 1 - Math.abs(p - 0.5) * 2;
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; break;
    }
    case 'wipe': {
      const x = ease.inOutExpo(p) * W;
      ctx.drawImage(a, 0, 0);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, H); ctx.clip(); ctx.drawImage(b, 0, 0); ctx.restore();
      ctx.fillStyle = pal.accent; ctx.fillRect(x - 3, 0, 6, H); break;
    }
    case 'slide': {
      const x = ease.inOutExpo(p) * W;
      ctx.drawImage(a, -x, 0); ctx.drawImage(b, W - x, 0); break;
    }
    case 'zoom': {
      ctx.save(); ctx.globalAlpha = 1 - e;
      const sa = 1 + 0.25 * e; ctx.translate(W / 2, H / 2); ctx.scale(sa, sa); ctx.drawImage(a, -W / 2, -H / 2); ctx.restore();
      ctx.save(); ctx.globalAlpha = e;
      const sb = 0.88 + 0.12 * e; ctx.translate(W / 2, H / 2); ctx.scale(sb, sb); ctx.drawImage(b, -W / 2, -H / 2); ctx.restore(); break;
    }
    case 'blur': {
      ctx.save(); ctx.filter = `blur(${Math.round(e * 30)}px)`; ctx.drawImage(a, 0, 0); ctx.restore();
      ctx.save(); ctx.globalAlpha = e; ctx.filter = `blur(${Math.round((1 - e) * 30)}px)`; ctx.drawImage(b, 0, 0); ctx.restore(); break;
    }
    default: // fade
      ctx.drawImage(a, 0, 0); ctx.globalAlpha = e; ctx.drawImage(b, 0, 0); ctx.globalAlpha = 1;
  }
}

function post(ctx, sb, t, W, H, grain) {
  const { vignette, grain: amount } = sb.style;
  if (vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${vignette * 0.75})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (amount > 0) {
    const frame = Math.floor(t * 24) % grain.length;
    ctx.save();
    ctx.globalAlpha = amount; ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(grain[frame], 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

// Four tiles of seeded noise, cycled per frame, so grain is identical in every export.
function makeGrain() {
  let s = 1337;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: 4 }, () => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), d = g.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = rnd() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    return c;
  });
}

function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }

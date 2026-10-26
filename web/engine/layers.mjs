// Motion-graphic layers. Each draw function gets the layer, its local time `lt` and duration
// `d`, and paints one frame. All sizes are in `u` (1 u = 1 px at 1080 short side), so a layer
// looks the same in 16:9, 9:16 and 1:1.
import { clamp01, ease, tween, rgba } from './ease.mjs';

const MARGIN = 96;

function font(px, family, { weight = 700, italic = false } = {}) {
  return `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px "${family}", "Inter", Arial, sans-serif`;
}

// "Make *it move*" → words with an accent flag; stars may span several words.
export function parseRuns(text) {
  const words = [];
  let accent = false;
  for (const raw of String(text).split(/\s+/).filter(Boolean)) {
    let w = raw;
    const opens = w.startsWith('*'); if (opens) { accent = true; w = w.slice(1); }
    const closes = w.endsWith('*'); if (closes) w = w.slice(0, -1);
    if (w) words.push({ text: w, accent });
    if (closes) accent = false;
  }
  return words;
}

function alignOf(pos) {
  const h = /left/.test(pos) ? 'left' : /right/.test(pos) ? 'right' : 'center';
  const v = /top/.test(pos) ? 'top' : /bottom/.test(pos) ? 'bottom' : 'middle';
  return { h, v };
}

function place(pos, W, H, u, bw, bh) {
  const m = MARGIN * u, { h, v } = alignOf(pos);
  return {
    x: h === 'left' ? m : h === 'right' ? W - m - bw : (W - bw) / 2,
    y: v === 'top' ? m : v === 'bottom' ? H - m - bh : (H - bh) / 2,
    h, v
  };
}

// Wraps words into lines no wider than maxW. Returns positions relative to the block.
function layout(ctx, words, maxW, px, style, lineGap = 1.04) {
  const space = px * 0.26;
  const measured = words.map(w => {
    ctx.font = w.accent ? font(px * 1.04, style.accentFont, { weight: 400, italic: true }) : font(px, style.font, { weight: style.weight ?? 700 });
    return { ...w, w: ctx.measureText(w.text).width };
  });
  const lines = [];
  let line = { words: [], width: 0 };
  for (const w of measured) {
    const add = (line.words.length ? space : 0) + w.w;
    if (line.words.length && line.width + add > maxW) { lines.push(line); line = { words: [], width: 0 }; }
    w.x = line.width + (line.words.length ? space : 0);
    line.width += (line.words.length ? space : 0) + w.w;
    line.words.push(w);
  }
  if (line.words.length) lines.push(line);
  const width = Math.max(0, ...lines.map(l => l.width));
  return { lines, width, height: lines.length * px * lineGap, lineH: px * lineGap };
}

function drawWords(ctx, block, origin, px, style, color, each) {
  let index = 0;
  block.lines.forEach((line, li) => {
    const dx = origin.h === 'left' ? 0 : origin.h === 'right' ? block.width - line.width : (block.width - line.width) / 2;
    const top = origin.y + li * block.lineH;
    for (const w of line.words) {
      ctx.save();
      ctx.font = w.accent ? font(px * 1.04, style.accentFont, { weight: 400, italic: true }) : font(px, style.font, { weight: style.weight ?? 700 });
      ctx.fillStyle = w.accent ? style.palette.accent : color;
      each(w, origin.x + dx + w.x, top + px * 0.84, index++, { top, lineH: block.lineH, left: origin.x + dx });
      ctx.restore();
    }
  });
}

function headline({ ctx, W, H, u, layer, lt, style }) {
  const px = { xl: 150, l: 112, m: 80 }[layer.size] * u;
  const side = /left|right/.test(layer.position);
  const block = layout(ctx, parseRuns(layer.text), (side ? 0.62 : 0.86) * W - (side ? 0 : 0), px, style, 1.0);
  const origin = place(layer.position, W, H, u, block.width, block.height);
  ctx.textBaseline = 'alphabetic';
  const totalChars = layer.text.replace(/\*/g, '').length;
  let charsSoFar = 0;
  drawWords(ctx, block, origin, px, style, style.palette.ink, (w, x, y, i, line) => {
    const at = i * 0.07;
    const e = tween(lt, at, 0.9);
    switch (layer.reveal) {
      case 'blur': {
        const p = tween(lt, at, 0.8, ease.outCubic);
        ctx.globalAlpha *= p; ctx.filter = `blur(${((1 - p) * 18 * u).toFixed(1)}px)`;
        ctx.fillText(w.text, x, y); break;
      }
      case 'type': {
        const shown = Math.max(0, Math.min(w.text.length, Math.floor(lt / (1.1 / Math.max(totalChars, 1) + 0.02)) - charsSoFar));
        charsSoFar += w.text.length + 1;
        ctx.fillText(w.text.slice(0, shown), x, y); break;
      }
      case 'split': {
        const dir = i % 2 ? 1 : -1;
        ctx.globalAlpha *= e; ctx.fillText(w.text, x + dir * (1 - e) * 220 * u, y); break;
      }
      case 'scale': {
        const p = tween(lt, at, 0.7, ease.outBack);
        ctx.globalAlpha *= clamp01(p * 1.5);
        ctx.translate(x + w.w / 2, y - px * 0.35); ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p);
        ctx.fillText(w.text, -w.w / 2, px * 0.35); break;
      }
      case 'mask': {
        ctx.beginPath(); ctx.rect(x - px * 0.2, line.top - px * 0.05, w.w + px * 0.4, line.lineH + px * 0.12); ctx.clip();
        ctx.fillText(w.text, x, y + (1 - e) * line.lineH * 1.05); break;
      }
      default: { // rise
        ctx.globalAlpha *= clamp01(e * 1.4);
        ctx.fillText(w.text, x, y + (1 - e) * px * 0.55);
      }
    }
  });
}

function subtitle({ ctx, W, H, u, layer, lt, style }) {
  const px = 42 * u;
  const st = { ...style, accentFont: style.font, weight: 500 };
  const block = layout(ctx, parseRuns(layer.text), Math.min(W * 0.78, 1300 * u), px, st, 1.3);
  const origin = place(layer.position, W, H, u, block.width, block.height);
  if (layer.position === 'center') origin.y += 175 * u;
  drawWords(ctx, block, origin, px, st, rgba(style.palette.ink, 0.86), (w, x, y, i) => {
    const p = tween(lt, i * 0.035, 0.6, ease.outCubic);
    ctx.globalAlpha *= p; ctx.filter = `blur(${((1 - p) * 8 * u).toFixed(1)}px)`;
    ctx.fillText(w.text, x, y + (1 - p) * 10 * u);
  });
}

function kicker({ ctx, W, H, u, layer, lt, style }) {
  const px = 24 * u, text = layer.text.toUpperCase();
  ctx.font = font(px, style.font, { weight: 600 });
  ctx.letterSpacing = `${(0.3 * px).toFixed(1)}px`;
  const tw = ctx.measureText(text).width;
  const o = place(layer.position, W, H, u, tw, px * 2);
  const shown = Math.floor(clamp01(lt / 0.6) * text.length);
  ctx.fillStyle = rgba(style.palette.ink, 0.88); ctx.textBaseline = 'top';
  ctx.fillText(text.slice(0, shown), o.x, o.y);
  const rule = tween(lt, 0.25, 0.7) * 44 * u;
  ctx.fillStyle = style.palette.accent;
  const ry = o.v === 'bottom' ? o.y - 16 * u : o.y + px * 1.6;
  ctx.fillRect(o.h === 'right' ? o.x + tw - rule : o.x, ry, rule, 3 * u);
}

function captions({ ctx, W, H, u, layer, lt, d, style }) {
  const words = String(layer.text).replace(/\*/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const per = (d * 0.92) / words.length;
  const cur = Math.min(words.length - 1, Math.floor(lt / per));
  const group = 4, g0 = Math.floor(cur / group) * group;
  const chunk = words.slice(g0, g0 + group);
  const px = 70 * u;
  ctx.font = font(px, style.font, { weight: 800 });
  const space = px * 0.28;
  const widths = chunk.map(w => ctx.measureText(w.toUpperCase()).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (chunk.length - 1);
  const o = place(layer.position, W, H, u, total, px);
  let x = o.x;
  ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  chunk.forEach((w, k) => {
    const idx = g0 + k, active = idx === cur;
    const pop = active ? 1 + 0.08 * (1 - tween(lt, idx * per, 0.25, ease.outCubic)) : 1;
    ctx.save();
    ctx.translate(x + widths[k] / 2, o.y + px * 0.8); ctx.scale(pop, pop);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 10 * u;
    ctx.globalAlpha *= idx <= cur ? 1 : 0.45;
    ctx.strokeText(w.toUpperCase(), -widths[k] / 2, 0);
    ctx.fillStyle = active ? style.palette.accent : style.palette.ink;
    ctx.fillText(w.toUpperCase(), -widths[k] / 2, 0);
    ctx.restore();
    x += widths[k] + space;
  });
}

function lowerThird({ ctx, W, H, u, layer, lt, style }) {
  const tpx = 48 * u, spx = 28 * u, pad = 28 * u;
  ctx.font = font(tpx, style.font); const tw = ctx.measureText(layer.title).width;
  ctx.font = font(spx, style.font, { weight: 500 }); const sw = ctx.measureText(layer.subtitle).width;
  const bw = Math.max(tw, sw) + pad * 2 + 12 * u, bh = tpx + spx + pad * 1.6;
  const o = place(layer.position, W, H, u, bw, bh);
  const grow = tween(lt, 0, 0.8);
  ctx.fillStyle = rgba(style.palette.bg, 0.78);
  ctx.fillRect(o.x, o.y, bw * grow, bh);
  ctx.fillStyle = style.palette.accent;
  ctx.fillRect(o.x, o.y + bh * (1 - tween(lt, 0, 0.5)), 8 * u, bh * tween(lt, 0, 0.5));
  ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.y, bw * grow, bh); ctx.clip();
  const slide = (1 - tween(lt, 0.15, 0.8)) * -40 * u;
  ctx.textBaseline = 'top';
  ctx.font = font(tpx, style.font); ctx.fillStyle = style.palette.ink;
  ctx.fillText(layer.title, o.x + pad + 12 * u + slide, o.y + pad * 0.7);
  ctx.font = font(spx, style.font, { weight: 500 }); ctx.fillStyle = style.palette.muted;
  ctx.globalAlpha *= tween(lt, 0.3, 0.6);
  ctx.fillText(layer.subtitle, o.x + pad + 12 * u + slide * 1.5, o.y + pad * 0.7 + tpx * 1.12);
  ctx.restore();
}

export function formatNumber(v, decimals) {
  const fixed = Math.abs(v).toFixed(decimals);
  const [i, f] = fixed.split('.');
  return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
}

function counter({ ctx, W, H, u, layer, lt, d, style }) {
  const px = 210 * u;
  const p = tween(lt, 0.1, Math.min(1.8, d * 0.7), ease.outExpo);
  const value = layer.from + (layer.to - layer.from) * p;
  const text = `${layer.prefix}${formatNumber(value, layer.decimals)}${layer.suffix}`;
  const final = `${layer.prefix}${formatNumber(layer.to, layer.decimals)}${layer.suffix}`;
  ctx.font = font(px, style.font, { weight: 800 });
  ctx.letterSpacing = `${(-0.03 * px).toFixed(1)}px`;
  const fw = ctx.measureText(final).width;
  const o = place(layer.position, W, H, u, fw, px * 1.4);
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = style.palette.ink;
  ctx.globalAlpha *= tween(lt, 0, 0.4);
  ctx.textAlign = 'left';
  ctx.fillText(text, o.x + (fw - ctx.measureText(text).width) / 2, o.y + px * 0.85);
  ctx.letterSpacing = '0px';
  ctx.font = font(30 * u, style.font, { weight: 600 });
  ctx.fillStyle = style.palette.accent;
  const label = layer.label.toUpperCase();
  ctx.letterSpacing = `${(9 * u).toFixed(1)}px`;
  const lw = ctx.measureText(label).width;
  ctx.globalAlpha *= tween(lt, 0.5, 0.6);
  ctx.fillText(label, o.x + (fw - lw) / 2, o.y + px * 1.25);
}

function bars({ ctx, W, H, u, layer, lt, style }) {
  const items = layer.items.length ? layer.items : [{ label: '—', value: 1 }];
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1e-9);
  const bw = Math.min(W - MARGIN * 2 * u, 1200 * u), rowH = 78 * u, labelW = 250 * u;
  const titleH = layer.title ? 80 * u : 0;
  const o = place(layer.position, W, H, u, bw, titleH + rowH * items.length);
  ctx.textBaseline = 'middle';
  if (layer.title) {
    ctx.font = font(44 * u, style.font); ctx.fillStyle = style.palette.ink;
    ctx.globalAlpha = tween(lt, 0, 0.5);
    ctx.fillText(layer.title, o.x, o.y + 26 * u);
    ctx.globalAlpha = 1;
  }
  items.forEach((it, k) => {
    const y = o.y + titleH + k * rowH + rowH / 2;
    const p = tween(lt, 0.2 + k * 0.12, 1.1, ease.outExpo);
    ctx.globalAlpha = clamp01(p * 2);
    ctx.font = font(30 * u, style.font, { weight: 600 }); ctx.fillStyle = style.palette.muted;
    ctx.fillText(it.label, o.x, y);
    const track = bw - labelW - 140 * u;
    ctx.fillStyle = rgba(style.palette.ink, 0.1); ctx.fillRect(o.x + labelW, y - 16 * u, track, 32 * u);
    const fw = track * (Math.abs(it.value) / max) * p;
    ctx.fillStyle = k === items.length - 1 || it.value === max ? style.palette.accent : style.palette.ink;
    ctx.fillRect(o.x + labelW, y - 16 * u, fw, 32 * u);
    ctx.font = font(32 * u, style.font, { weight: 700 }); ctx.fillStyle = style.palette.ink;
    ctx.fillText(`${formatNumber(it.value * p, Number.isInteger(it.value) ? 0 : 1)}${layer.unit}`, o.x + labelW + fw + 16 * u, y);
  });
  ctx.globalAlpha = 1;
}

function list({ ctx, W, H, u, layer, lt, style }) {
  const px = 54 * u, rowH = px * 1.6, items = layer.items;
  ctx.font = font(px, style.font);
  const maxW = Math.max(...items.map(t => ctx.measureText(t).width), 1) + 110 * u;
  const titleH = layer.title ? px * 1.5 : 0;
  const o = place(layer.position, W, H, u, Math.min(maxW, W - MARGIN * 2 * u), titleH + rowH * items.length);
  ctx.textBaseline = 'alphabetic';
  if (layer.title) {
    ctx.font = font(28 * u, style.font, { weight: 600 }); ctx.fillStyle = style.palette.muted;
    ctx.letterSpacing = `${(8 * u).toFixed(1)}px`; ctx.globalAlpha = tween(lt, 0, 0.5);
    ctx.fillText(layer.title.toUpperCase(), o.x, o.y + 30 * u);
    ctx.letterSpacing = '0px'; ctx.globalAlpha = 1;
  }
  items.forEach((text, k) => {
    const p = tween(lt, 0.15 + k * 0.18, 0.8);
    const y = o.y + titleH + k * rowH + px;
    ctx.globalAlpha = clamp01(p * 1.3);
    const dx = (1 - p) * -50 * u;
    ctx.font = font(px * 0.62, style.font, { weight: 700 }); ctx.fillStyle = style.palette.accent;
    ctx.fillText(String(k + 1).padStart(2, '0'), o.x + dx, y - px * 0.08);
    ctx.font = font(px, style.font); ctx.fillStyle = style.palette.ink;
    ctx.fillText(text, o.x + 100 * u + dx, y);
  });
  ctx.globalAlpha = 1;
}

function quote({ ctx, W, H, u, layer, lt, style }) {
  const px = 68 * u;
  const qs = { ...style, font: style.accentFont };
  const words = parseRuns(layer.text).map(w => ({ ...w, accent: false }));
  ctx.font = font(px, style.accentFont, { weight: 400, italic: true });
  const block = layout(ctx, words, Math.min(W * 0.72, 1300 * u), px, qs, 1.18);
  const o = place(layer.position, W, H, u, block.width, block.height + 160 * u);
  ctx.font = font(220 * u, style.accentFont, { weight: 400 }); ctx.fillStyle = style.palette.accent;
  ctx.globalAlpha = tween(lt, 0, 0.6); ctx.textBaseline = 'alphabetic';
  ctx.fillText('“', o.x + (o.h === 'center' ? block.width / 2 - 50 * u : -10 * u), o.y + 150 * u);
  ctx.globalAlpha = 1;
  const top = { ...o, y: o.y + 120 * u };
  drawWords(ctx, block, top, px, qs, style.palette.ink, (w, x, y, i) => {
    ctx.font = font(px, style.accentFont, { weight: 400, italic: true });
    const p = tween(lt, 0.2 + i * 0.04, 0.7, ease.outCubic);
    ctx.globalAlpha *= p; ctx.fillText(w.text, x, y + (1 - p) * 14 * u);
  });
  if (layer.author) {
    ctx.font = font(28 * u, style.font, { weight: 600 }); ctx.fillStyle = style.palette.muted;
    ctx.letterSpacing = `${(6 * u).toFixed(1)}px`;
    const a = `— ${layer.author.toUpperCase()}`, aw = ctx.measureText(a).width;
    ctx.globalAlpha = tween(lt, 0.9, 0.6);
    ctx.fillText(a, o.h === 'center' ? o.x + (block.width - aw) / 2 : o.x, top.y + block.height + 60 * u);
  }
}

function pill(ctx, x, y, w, h) {
  const r = h / 2;
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function chips({ ctx, W, H, u, layer, lt, style }) {
  const px = 30 * u, h = 66 * u, padX = 30 * u, gap = 16 * u;
  ctx.font = font(px, style.font, { weight: 600 });
  const ws = layer.items.map(t => ctx.measureText(t).width + padX * 2);
  const total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  const o = place(layer.position, W, H, u, total, h);
  let x = o.x;
  ctx.textBaseline = 'middle';
  layer.items.forEach((t, k) => {
    const p = tween(lt, k * 0.09, 0.6, ease.outBack);
    ctx.save();
    ctx.translate(x + ws[k] / 2, o.y + h / 2); ctx.scale(Math.max(0.01, p), Math.max(0.01, p));
    ctx.globalAlpha *= clamp01(p * 2);
    pill(ctx, -ws[k] / 2, -h / 2, ws[k], h);
    ctx.fillStyle = rgba(style.palette.bg, 0.55); ctx.fill();
    ctx.lineWidth = 2 * u; ctx.strokeStyle = k === 0 ? style.palette.accent : rgba(style.palette.ink, 0.35); ctx.stroke();
    ctx.fillStyle = style.palette.ink; ctx.fillText(t, -ws[k] / 2 + padX, 2 * u);
    ctx.restore();
    x += ws[k] + gap;
  });
}

function cta({ ctx, W, H, u, layer, lt, style }) {
  const px = 46 * u, h = 112 * u, padX = 56 * u;
  ctx.font = font(px, style.font, { weight: 800 });
  const w = ctx.measureText(layer.text).width + padX * 2;
  const o = place(layer.position, W, H, u, w, h + (layer.sub ? 70 * u : 0));
  const p = tween(lt, 0, 0.7, ease.outBack);
  ctx.save();
  ctx.translate(o.x + w / 2, o.y + h / 2); ctx.scale(Math.max(0.01, p), Math.max(0.01, p));
  ctx.globalAlpha *= clamp01(p * 2);
  pill(ctx, -w / 2, -h / 2, w, h); ctx.fillStyle = style.palette.accent; ctx.fill();
  ctx.save(); ctx.clip();
  const sx = -w / 2 + (w * 1.6) * tween(lt, 0.8, 1.0, ease.inOutCubic) - w * 0.3;
  const g = ctx.createLinearGradient(sx - 80 * u, 0, sx + 80 * u, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  ctx.fillStyle = style.palette.bg; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(layer.text, 0, 3 * u);
  ctx.restore();
  if (layer.sub) {
    ctx.font = font(28 * u, style.font, { weight: 500 }); ctx.fillStyle = style.palette.muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.globalAlpha *= tween(lt, 0.5, 0.6);
    ctx.fillText(layer.sub, o.x + w / 2, o.y + h + 30 * u);
  }
}

function logo({ ctx, W, H, u, layer, lt, style }) {
  const px = 200 * u, chars = [...layer.text];
  ctx.font = font(px, style.font, { weight: 800 });
  ctx.letterSpacing = `${(-0.04 * px).toFixed(1)}px`;
  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const o = place(layer.position, W, H, u, total, px);
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = style.palette.ink;
  let x = o.x;
  chars.forEach((c, k) => {
    const e = tween(lt, 0.1 + k * 0.055, 1.0);
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 4 * u, o.y - px * 0.1, widths[k] + 8 * u, px * 1.25); ctx.clip();
    ctx.fillStyle = c === '.' ? style.palette.accent : style.palette.ink;
    ctx.fillText(c, x, o.y + px * 0.86 + (1 - e) * px * 1.1);
    ctx.restore();
    x += widths[k];
  });
}

function lens({ ctx, W, H, u, layer, lt, d }) {
  const s = layer.size * Math.min(W, H);
  const p = ease.inOutSine(clamp01(lt / d));
  const cx = W + s - p * (W + s * 2), cy = H / 2 + Math.sin(p * Math.PI * 2) * 40 * u;
  const grow = 1 + 0.25 * Math.sin(p * Math.PI);
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.translate(cx, cy); ctx.rotate((p - 0.5) * -0.2); ctx.scale(grow, grow);
  const r = s * 0.15;
  ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, r);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.restore();
}

function frame({ ctx, W, H, u, layer, lt, style }) {
  const p = tween(lt, 0, 0.9);
  ctx.strokeStyle = rgba(style.palette.ink, 0.75); ctx.lineWidth = 3 * u;
  if (layer.style === 'letterbox') {
    const bh = H * 0.11 * p; ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
  } else if (layer.style === 'grid') {
    const step = 120 * u; ctx.strokeStyle = rgba(style.palette.ink, 0.1 * p); ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  } else if (layer.style === 'border') {
    const m = 40 * u, per = 2 * (W + H - 4 * m);
    ctx.setLineDash([per * p, per]); ctx.strokeRect(m, m, W - 2 * m, H - 2 * m); ctx.setLineDash([]);
  } else {
    const m = 54 * u, L = 64 * u * p;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y);
    }
    ctx.stroke();
  }
}

function progress({ ctx, W, H, u, layer, lt, d, style }) {
  const m = MARGIN * u, y = layer.position === 'top' ? 40 * u : H - 44 * u;
  ctx.fillStyle = rgba(style.palette.ink, 0.18); ctx.fillRect(m, y, W - 2 * m, 4 * u);
  ctx.fillStyle = style.palette.accent; ctx.fillRect(m, y, (W - 2 * m) * clamp01(lt / d), 4 * u);
}

function flash({ ctx, W, H, layer, lt, style }) {
  const a = layer.strength * Math.pow(1 - clamp01(lt / 0.7), 2);
  if (a <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const g = ctx.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, Math.max(W, H));
  g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.35, rgba(style.palette.accent, a * 0.6)); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
}

export const LAYER_DRAW = { headline, subtitle, kicker, captions, lowerThird, counter, bars, list, quote, chips, cta, logo, lens, frame, progress, flash };

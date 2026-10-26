// The storyboard is the whole project: scenes, their images, the motion layers on top and
// how scenes hand over to each other. It is plain JSON so a director model can write it,
// people can edit it, and the browser renders it identically in preview and export.
// This file has no DOM code; the server imports it to validate director output.

export const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
export const CAMERA_MOVES = ['push', 'pull', 'pan-left', 'pan-right', 'rise', 'fall', 'drift', 'still'];
export const TRANSITIONS = ['cut', 'fade', 'dip', 'flash', 'wipe', 'slide', 'zoom', 'blur'];
export const BACKGROUNDS = ['image', 'gradient', 'solid', 'grid'];
export const FONTS = ['Inter Tight', 'Space Grotesk', 'Instrument Serif', 'Archivo Black', 'JetBrains Mono', 'Arial'];
export const POSITIONS = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

// Every motion layer: its fields, defaults and a one-line purpose (also fed to the director).
export const LAYERS = {
  headline: { about: 'Big kinetic title. Wrap one or two words in *stars* to accent them.', defaults: { text: 'Headline', size: 'xl', position: 'center', reveal: 'rise' }, reveals: ['rise', 'blur', 'type', 'split', 'mask', 'scale'] },
  subtitle: { about: 'One supporting line under or near a headline.', defaults: { text: 'A supporting line', position: 'bottom', reveal: 'blur' } },
  kicker: { about: 'Small uppercase label with a short rule, for section names or context.', defaults: { text: 'CHAPTER ONE', position: 'top-left' } },
  captions: { about: 'Word-by-word captions, the current word highlighted. For voice-over style lines.', defaults: { text: 'Say it one word at a time', position: 'bottom' } },
  lowerThird: { about: 'Name bar: title plus a smaller subtitle, slides in from the side.', defaults: { title: 'Name Surname', subtitle: 'Role or place', position: 'bottom-left' } },
  counter: { about: 'Number that counts up to a value with a label.', defaults: { from: 0, to: 100, prefix: '', suffix: '%', decimals: 0, label: 'growth', position: 'center' } },
  bars: { about: 'Horizontal bar chart, 2-6 items, values on the same unit.', defaults: { title: '', unit: '', items: [{ label: 'A', value: 40 }, { label: 'B', value: 75 }, { label: 'C', value: 100 }], position: 'center' } },
  list: { about: 'Numbered steps or bullets, 2-5 short items, staggered in.', defaults: { title: '', items: ['First', 'Second', 'Third'], position: 'left' } },
  quote: { about: 'Pull quote with attribution.', defaults: { text: 'A short quote worth reading', author: '', position: 'center' } },
  chips: { about: 'Row of pill tags, 2-6 short words.', defaults: { items: ['Fast', 'Simple', 'Yours'], position: 'bottom' } },
  cta: { about: 'Call to action: a button-like pill and a small line under it.', defaults: { text: 'Try it free', sub: '', position: 'center' } },
  logo: { about: 'Wordmark lockup that resolves on screen. Use for openers and end cards.', defaults: { text: 'brand.', position: 'center' } },
  lens: { about: 'A rounded square that sweeps across and inverts whatever it passes over.', defaults: { size: 0.28 } },
  frame: { about: 'Graphic framing: corner brackets, letterbox bars or a fine grid.', defaults: { style: 'brackets' }, styles: ['brackets', 'letterbox', 'grid', 'border'] },
  progress: { about: 'Thin line that fills across the bottom over the layer duration.', defaults: { position: 'bottom' } },
  flash: { about: 'Quick light leak / flash for impact on a beat.', defaults: { strength: 0.8 } }
};

export const DEFAULT_STYLE = {
  palette: { bg: '#0b0b0d', ink: '#f5f5f2', accent: '#ff5b1f', muted: '#8d8d8a' },
  font: 'Inter Tight', accentFont: 'Instrument Serif',
  grain: 0.05, vignette: 0.35, imageStyle: ''
};

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, d = '', max = 400) => (typeof v === 'string' ? v : v == null ? d : String(v)).slice(0, max);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const color = (v, d) => (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : d);
const librarySrc = v => (typeof v === 'string' && /^(\/library\/|data:image\/)/.test(v) ? v : '');
let counter = 0;
export const uid = p => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function normalizeLayer(raw, sceneDuration) {
  if (!raw || !LAYERS[raw.type]) return null;
  const def = LAYERS[raw.type];
  const layer = { id: str(raw.id) || uid('l'), type: raw.type };
  layer.start = num(raw.start, 0, sceneDuration - 0.2, 0);
  layer.duration = num(raw.duration, 0.3, sceneDuration - layer.start, sceneDuration - layer.start);
  for (const [k, d] of Object.entries(def.defaults)) {
    const v = raw[k];
    if (Array.isArray(d)) {
      const list = Array.isArray(v) ? v.slice(0, 6) : d;
      layer[k] = typeof d[0] === 'object'
        ? list.map(x => ({ label: str(x?.label, '', 40), value: num(x?.value, -1e9, 1e9, 0) }))
        : list.map(x => str(x, '', 60));
    } else if (typeof d === 'number') layer[k] = num(v, -1e12, 1e12, d);
    else layer[k] = str(v, d, 240);
  }
  if ('position' in def.defaults) layer.position = oneOf(raw.position, POSITIONS, def.defaults.position);
  if (def.reveals) layer.reveal = oneOf(raw.reveal, def.reveals, def.defaults.reveal);
  if (def.styles) layer.style = oneOf(raw.style, def.styles, def.defaults.style);
  if (raw.type === 'headline') layer.size = oneOf(raw.size, ['xl', 'l', 'm'], 'xl');
  if (raw.type === 'counter') layer.decimals = Math.round(num(raw.decimals, 0, 3, 0));
  return layer;
}

export function normalizeScene(raw = {}, i = 0) {
  const duration = num(raw.duration, 1, 20, 4);
  const img = raw.image && typeof raw.image === 'object' ? raw.image : {};
  const scene = {
    id: str(raw.id) || uid('s'),
    name: str(raw.name, `Scene ${i + 1}`, 40),
    duration,
    background: oneOf(raw.background, BACKGROUNDS, img.prompt || img.src ? 'image' : 'gradient'),
    image: {
      prompt: str(img.prompt, '', 1200), provider: str(img.provider, '', 40), model: str(img.model, '', 120),
      src: librarySrc(img.src),
      history: (Array.isArray(img.history) ? img.history : []).map(librarySrc).filter(Boolean).slice(-12)
    },
    camera: { move: oneOf(raw.camera?.move, CAMERA_MOVES, 'push'), amount: num(raw.camera?.amount, 0, 1, 0.5) },
    dim: num(raw.dim, 0, 0.9, 0.35),
    transition: { type: oneOf(raw.transition?.type ?? raw.transition, TRANSITIONS, i === 0 ? 'cut' : 'fade'), duration: num(raw.transition?.duration, 0.1, 1.5, 0.5) },
    layers: []
  };
  scene.layers = (Array.isArray(raw.layers) ? raw.layers : []).map(l => normalizeLayer(l, duration)).filter(Boolean).slice(0, 8);
  return scene;
}

export function normalize(raw = {}) {
  const style = raw.style || {};
  const pal = style.palette || {};
  const sb = {
    version: 1,
    title: str(raw.title, 'Untitled', 120),
    aspect: oneOf(raw.aspect, Object.keys(ASPECTS), '16:9'),
    fps: oneOf(Number(raw.fps), [24, 25, 30, 60], 30),
    style: {
      palette: {
        bg: color(pal.bg, DEFAULT_STYLE.palette.bg), ink: color(pal.ink, DEFAULT_STYLE.palette.ink),
        accent: color(pal.accent, DEFAULT_STYLE.palette.accent), muted: color(pal.muted, DEFAULT_STYLE.palette.muted)
      },
      font: oneOf(style.font, FONTS, DEFAULT_STYLE.font),
      accentFont: oneOf(style.accentFont, FONTS, DEFAULT_STYLE.accentFont),
      grain: num(style.grain, 0, 0.3, DEFAULT_STYLE.grain),
      vignette: num(style.vignette, 0, 1, DEFAULT_STYLE.vignette),
      imageStyle: str(style.imageStyle, '', 400)
    },
    music: raw.music && typeof raw.music.src === 'string' ? { src: raw.music.src, name: str(raw.music.name, 'music', 80), volume: num(raw.music.volume, 0, 1, 0.8) } : null,
    scenes: []
  };
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.slice(0, 40) : [];
  sb.scenes = scenes.map(normalizeScene);
  if (!sb.scenes.length) sb.scenes.push(normalizeScene({}, 0));
  sb.scenes[0].transition = { type: 'cut', duration: 0.1 };
  return sb;
}

// Start time of each scene. A transition overlaps the end of the previous scene.
export function timeline(sb) {
  let t = 0;
  const spans = sb.scenes.map((s, i) => {
    const overlap = i === 0 || s.transition.type === 'cut' ? 0 : Math.min(s.transition.duration, s.duration / 2, sb.scenes[i - 1].duration / 2);
    t -= overlap;
    const span = { index: i, scene: s, start: t, end: t + s.duration, overlap };
    t += s.duration;
    return span;
  });
  return { spans, duration: Math.max(0.1, t) };
}

export function size(sb) {
  const [width, height] = ASPECTS[sb.aspect];
  return { width, height };
}

// The full prompt sent to an image model: the scene prompt plus the project-wide look.
export function imagePrompt(sb, scene) {
  const parts = [scene.image.prompt.trim()];
  if (sb.style.imageStyle.trim()) parts.push(sb.style.imageStyle.trim());
  parts.push('no text, no watermark, no logos');
  return parts.filter(Boolean).join('. ');
}

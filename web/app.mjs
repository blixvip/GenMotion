// GenMotion studio: idea → storyboard → images → motion → MP4.
import { normalize, normalizeScene, normalizeLayer, timeline, size, imagePrompt, LAYERS, CAMERA_MOVES, TRANSITIONS, BACKGROUNDS, FONTS, POSITIONS, uid } from './engine/storyboard.mjs';
import { createRenderer } from './engine/render.mjs';
import { exportMp4, canExport } from './engine/export.mjs';

const $ = id => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};
const clock = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
};

// ---------- state ----------
// First run opens the bundled demo film (web/demo.genmotion.json); after that, the last project.
const saved = store.get('genmotion:project', null);
let sb = normalize(saved || { title: 'GenMotion', scenes: [{ background: 'gradient', layers: [{ type: 'logo', text: 'genmotion.' }] }] });
let projectId = store.get('genmotion:projectId', '') || uid('p').toLowerCase().replace(/[^a-z0-9]/g, '');
let sel = 0, selLayer = null, t = 0, playing = false, loop = true, mode = 'images', providers = null, tab = 'scene';
const busy = new Map(); // scene id → 'busy' | 'failed'
const undo = [], redo = [];

// ---------- images ----------
const images = new Map();
function image(src) {
  if (!src) return null;
  let rec = images.get(src);
  if (!rec) {
    const img = new Image();
    rec = { img, ok: false };
    img.onload = () => { rec.ok = true; draw(); };
    // Keep the failed record so the preview doesn't re-request it every frame.
    img.onerror = () => { rec.failed = true; console.warn(`Image failed to load: ${src}`); };
    img.src = src;
    images.set(src, rec);
  }
  return rec.ok ? rec.img : null;
}
async function preloadAll() {
  await Promise.all(sb.scenes.map(s => s.image.src).filter(Boolean).map(src => new Promise(resolve => {
    const rec = images.get(src);
    if (rec?.ok) return resolve();
    image(src);
    const r = images.get(src);
    if (!r) return resolve();
    r.img.addEventListener('load', resolve, { once: true });
    r.img.addEventListener('error', resolve, { once: true });
  })));
}

// ---------- api ----------
async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method, headers: body && !(body instanceof Blob) ? { 'content-type': 'application/json', ...headers } : headers,
    body: body && !(body instanceof Blob) ? JSON.stringify(body) : body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, bad = false) {
  const el = $('toast');
  el.textContent = msg; el.classList.toggle('bad', bad); el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), bad ? 6000 : 2600);
}

// ---------- history + save ----------
function commit(fn, { rerender = true } = {}) {
  undo.push(JSON.stringify(sb)); if (undo.length > 80) undo.shift(); redo.length = 0;
  fn();
  sb = normalize(sb);
  changed(rerender);
}
function changed(rerender = true) {
  store.set('genmotion:project', sb);
  clearTimeout(changed.t);
  changed.t = setTimeout(() => api(`/api/projects/${projectId}`, { method: 'PUT', body: { storyboard: sb } }).catch(() => {}), 800);
  if (rerender) renderAll(); else { renderTimeline(); renderSceneList(); }
  draw();
}
function step(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(sb));
  sb = normalize(JSON.parse(from.pop()));
  sel = Math.min(sel, sb.scenes.length - 1);
  changed();
}
store.set('genmotion:projectId', projectId);

// ---------- preview ----------
const renderer = createRenderer($('canvas'), { image });
function sceneStart(i) { return timeline(sb).spans[i]?.start ?? 0; }
function draw() {
  const info = renderer.draw(sb, t);
  const { duration } = timeline(sb);
  $('time').textContent = clock(t); $('total').textContent = clock(duration);
  $('scrub').max = duration; $('scrub').value = t;
  const track = $('track');
  if (track.offsetWidth) $('playhead').style.left = `${16 + (t / duration) * track.offsetWidth}px`;
  if (playing && info.scene !== sel) { sel = info.scene; renderSceneList(); renderTimeline(); }
}
let last = 0;
function tick(now) {
  if (playing) {
    const dt = Math.min(0.1, (now - last) / 1000);
    const { duration } = timeline(sb);
    t += dt;
    if (t >= duration) { if (loop) t = 0; else { t = duration - 1e-3; setPlaying(false); } }
    draw();
  }
  last = now;
  requestAnimationFrame(tick);
}
function setPlaying(on) {
  playing = on;
  $('play').innerHTML = on ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>';
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  if (!on) { renderSceneList(); renderInspector(); }
}
function seekScene(i) { sel = i; selLayer = null; t = sceneStart(i) + (i ? Math.min(0.6, sb.scenes[i].transition.duration) : 0) + 0.01; renderAll(); draw(); }

// ---------- scene list ----------
function sceneThumb(s) {
  const st = busy.get(s.id);
  const pal = sb.style.palette;
  const look = {
    image: 'var(--sunk)',
    solid: pal.bg,
    grid: `linear-gradient(${pal.ink}14 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, ${pal.ink}14 1px, ${pal.bg} 1px) 0 0 / 12px 12px`,
    gradient: `radial-gradient(circle at 30% 40%, ${pal.accent}66, ${pal.bg} 70%)`
  }[s.background];
  return h('div', { class: `thumb ${st || ''}`, style: s.image.src ? { backgroundImage: `url("${s.image.src}")` } : { background: look } });
}
let dragFrom = null;
function renderSceneList() {
  const list = $('scene-list');
  list.replaceChildren(...sb.scenes.map((s, i) => {
    const text = s.layers.find(l => l.text || l.title)?.text || s.layers.find(l => l.title)?.title || s.image.prompt || s.background;
    return h('li', {
      class: `scene-card ${i === sel ? 'active' : ''}`, draggable: true, tabindex: 0, 'aria-label': `Scene ${i + 1}: ${s.name}`,
      onclick: () => seekScene(i), onkeydown: e => { if (e.key === 'Enter') seekScene(i); },
      ondragstart: e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; },
      ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); },
      ondragleave: e => e.currentTarget.classList.remove('drag-over'),
      ondrop: e => {
        e.preventDefault();
        if (dragFrom == null || dragFrom === i) return;
        commit(() => { const [m] = sb.scenes.splice(dragFrom, 1); sb.scenes.splice(i, 0, m); sel = i; });
        dragFrom = null;
      }
    },
    h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
    sceneThumb(s),
    h('div', { class: 'meta' }, h('div', { class: 'name' }, s.name), h('div', { class: 'sub' }, `${s.duration.toFixed(1)}s · ${String(text).replace(/\*/g, '')}`)));
  }));
}

// ---------- timeline ----------
function renderTimeline() {
  const { spans, duration } = timeline(sb);
  const track = $('track');
  track.replaceChildren(...spans.map(sp => {
    const s = sp.scene;
    const clip = h('div', {
      class: `clip ${sp.index === sel ? 'active' : ''}`,
      style: { left: `${(sp.start / duration) * 100}%`, width: `calc(${(s.duration / duration) * 100}% - 2px)`, backgroundImage: s.image.src ? `url("${s.image.src}")` : '' },
      title: `${s.name} · ${s.duration.toFixed(1)}s`
    }, h('span', {}, s.name));
    const handle = h('div', { class: 'handle', title: 'Drag to change length' });
    handle.addEventListener('pointerdown', e => {
      e.stopPropagation(); handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX, d0 = s.duration, pxPerSec = track.offsetWidth / duration;
      undo.push(JSON.stringify(sb)); redo.length = 0;
      const move = ev => { s.duration = Math.max(1, Math.min(20, Math.round((d0 + (ev.clientX - x0) / pxPerSec) * 10) / 10)); for (const l of s.layers) { l.start = Math.min(l.start, s.duration - 0.2); l.duration = Math.min(l.duration, s.duration - l.start); } renderTimeline(); draw(); };
      const up = () => { handle.removeEventListener('pointermove', move); sb = normalize(sb); changed(); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up, { once: true });
    });
    clip.append(handle);
    return clip;
  }));
  const span = spans[sel];
  const lt = $('layers-track');
  lt.replaceChildren(...(span ? span.scene.layers.map((l, k) => h('div', {
    class: `lbar ${l.id === selLayer ? 'sel' : ''}`,
    style: { left: `${((span.start + l.start) / duration) * 100}%`, width: `${(l.duration / duration) * 100}%`, top: `${k * 16}px` }
  }, LABELS[l.type] || l.type)) : []));
  lt.style.height = `${span ? span.scene.layers.length * 16 : 0}px`;
}
function scrubFromEvent(e) {
  const r = $('track').getBoundingClientRect();
  const { duration, spans } = timeline(sb);
  t = Math.max(0, Math.min(duration - 1e-3, ((e.clientX - r.left) / r.width) * duration));
  const i = spans.findIndex(s => t >= s.start && t < s.end);
  if (i >= 0 && i !== sel) { sel = i; selLayer = null; renderSceneList(); renderInspector(); renderTimeline(); }
  draw();
}
$('timeline').addEventListener('pointerdown', e => {
  if (e.target.classList.contains('handle')) return;
  $('timeline').setPointerCapture(e.pointerId); scrubFromEvent(e);
  const move = ev => scrubFromEvent(ev);
  $('timeline').addEventListener('pointermove', move);
  $('timeline').addEventListener('pointerup', () => $('timeline').removeEventListener('pointermove', move), { once: true });
});

// ---------- inspector helpers ----------
const LABELS = { headline: 'Headline', subtitle: 'Subtitle', kicker: 'Kicker', captions: 'Captions', lowerThird: 'Lower third', counter: 'Counter', bars: 'Bar chart', list: 'List', quote: 'Quote', chips: 'Chips', cta: 'Call to action', logo: 'Logo', glass: 'Liquid glass', lens: 'Lens', frame: 'Frame', progress: 'Progress', flash: 'Flash' };
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint && h('small', { class: 'model-hint' }, hint));
const select = (value, options, onchange, labels = {}) => h('select', { onchange: e => onchange(e.target.value) }, ...options.map(o => h('option', { value: o, selected: o === value }, labels[o] || o)));
const number = (value, onchange, { min, max, step = 0.1 } = {}) => h('input', { type: 'number', value, min, max, step, onchange: e => onchange(Number(e.target.value)) });
const text = (value, onchange, { area = false, rows = 3, placeholder = '' } = {}) => area
  ? h('textarea', { rows, placeholder, oninput: e => onchange(e.target.value, false), onchange: e => onchange(e.target.value, true) }, value)
  : h('input', { type: 'text', value, placeholder, oninput: e => onchange(e.target.value, false), onchange: e => onchange(e.target.value, true) });

// Edits while typing update the preview live; the undo snapshot is taken once per field focus.
function live(mutate) {
  let snap = false;
  return (v, done) => {
    if (!snap) { undo.push(JSON.stringify(sb)); redo.length = 0; snap = true; }
    mutate(v);
    if (done) { snap = false; sb = normalize(sb); changed(false); } else { store.set('genmotion:project', sb); draw(); renderTimeline(); }
  };
}

function renderAll() { renderSceneList(); renderTimeline(); renderInspector(); syncChrome(); }
function syncChrome() {
  $('title').value = sb.title; $('aspect').value = sb.aspect;
  const c = $('canvas'), { width, height } = size(sb);
  c.style.aspectRatio = `${width} / ${height}`;
}

function renderInspector() {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('.tab')) p.hidden = p.dataset.pane !== tab;
  if (tab === 'scene') renderScenePane();
  if (tab === 'layers') renderLayersPane();
  if (tab === 'style') renderStylePane();
}

// ---------- scene pane ----------
function imageModels() { return providers?.image || []; }
function chosenModel(scene) {
  const all = imageModels();
  const want = scene?.image.provider || store.get('genmotion:imageModel', '');
  return all.find(p => p.id === want && p.ready) || all.find(p => p.ready) || all.find(p => p.id === want) || all[0];
}

function renderScenePane() {
  const s = sb.scenes[sel];
  const pane = $('pane-scene');
  if (!s) return pane.replaceChildren(h('p', { class: 'empty' }, 'No scene selected'));
  const p = chosenModel(s);
  const st = busy.get(s.id);
  const preview = h('div', { class: `image-preview ${st === 'busy' ? 'busy' : ''}`, style: s.image.src ? { backgroundImage: `url("${s.image.src}")` } : {} },
    s.image.src ? '' : st === 'busy' ? 'Generating…' : s.background === 'image' ? 'No image yet' : `Background: ${s.background}`);
  const providerSel = h('select', { onchange: e => { const id = e.target.value; store.set('genmotion:imageModel', id); commit(() => { s.image.provider = id; s.image.model = ''; }); } },
    h('optgroup', { label: 'Global' }, ...imageModels().filter(m => m.region === 'global' && !m.freeModel).map(optModel(p))),
    h('optgroup', { label: 'China' }, ...imageModels().filter(m => m.region === 'china').map(optModel(p))),
    h('optgroup', { label: 'Any model (aggregators)' }, ...imageModels().filter(m => m.freeModel).map(optModel(p))));
  const modelIn = p?.freeModel
    ? h('input', { type: 'text', value: s.image.model || p.defaultModel, list: 'model-ids', onchange: e => commit(() => { s.image.model = e.target.value.trim(); s.image.provider = p.id; }) })
    : select(s.image.model || p?.defaultModel, p?.models || [], v => commit(() => { s.image.model = v; s.image.provider = p.id; }));
  const dl = h('datalist', { id: 'model-ids' }, ...(p?.models || []).map(m => h('option', { value: m })));
  pane.replaceChildren(
    h('div', { class: 'group' },
      h('h3', {}, 'Scene', h('span', { class: 'muted' }, `${sel + 1} / ${sb.scenes.length}`)),
      field('Name', text(s.name, live(v => { s.name = v; }))),
      h('div', { class: 'field-row' },
        field('Length (s)', number(s.duration, v => commit(() => { s.duration = v; }), { min: 1, max: 20 })),
        field('Background', select(s.background, BACKGROUNDS, v => commit(() => { s.background = v; }))))),
    h('div', { class: 'group' },
      h('h3', {}, 'Image'),
      preview,
      field('Prompt', text(s.image.prompt, live(v => { s.image.prompt = v; }), { area: true, rows: 4, placeholder: 'What should this frame show? Subject, place, light, lens…' })),
      h('div', { class: 'model-pick' }, field('Model', providerSel), field('Version', modelIn)), dl,
      p && h('p', { class: 'model-hint' }, p.ready ? p.strengths : `Needs ${p.keys.join(' + ')} — add it under API keys.`),
      h('div', { class: 'btns' },
        h('button', { class: 'primary', disabled: st === 'busy' || !s.image.prompt.trim(), onclick: () => generate(s) }, s.image.src ? 'Regenerate' : 'Generate'),
        h('button', { onclick: () => { uploadTarget = s; $('file-image').click(); } }, 'Upload'),
        h('button', { onclick: () => openLibrary() }, 'Library')),
      s.image.history.length > 1 && h('div', { class: 'history' }, ...s.image.history.slice().reverse().map(src => h('button', {
        class: src === s.image.src ? 'on' : '', style: { backgroundImage: `url("${src}")` }, title: 'Use this take', 'aria-label': 'Use this take',
        onclick: () => commit(() => { s.image.src = src; s.background = 'image'; })
      })))),
    h('div', { class: 'group' },
      h('h3', {}, 'Camera'),
      h('div', { class: 'field-row' },
        field('Move', select(s.camera.move, CAMERA_MOVES, v => commit(() => { s.camera.move = v; }))),
        field('Amount', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.camera.amount, oninput: e => live(v => { s.camera.amount = v; })(Number(e.target.value), false), onchange: e => live(v => { s.camera.amount = v; })(Number(e.target.value), true) }))),
      field('Darken image', h('input', { type: 'range', min: 0, max: 0.9, step: 0.05, value: s.dim, oninput: e => live(v => { s.dim = v; })(Number(e.target.value), false), onchange: e => live(v => { s.dim = v; })(Number(e.target.value), true) }))),
    h('div', { class: 'group' },
      h('h3', {}, 'Transition in'),
      h('div', { class: 'field-row' },
        field('Type', select(s.transition.type, TRANSITIONS, v => commit(() => { s.transition.type = v; }))),
        field('Length (s)', number(s.transition.duration, v => commit(() => { s.transition.duration = v; }), { min: 0.1, max: 1.5 })))),
    h('div', { class: 'btns' },
      h('button', { onclick: () => commit(() => { const copy = normalizeScene(JSON.parse(JSON.stringify(s))); copy.id = uid('s'); copy.name = `${s.name} copy`; sb.scenes.splice(sel + 1, 0, copy); sel++; }) }, 'Duplicate'),
      h('button', { class: 'danger', disabled: sb.scenes.length < 2, onclick: () => commit(() => { sb.scenes.splice(sel, 1); sel = Math.max(0, sel - 1); }) }, 'Delete scene'))
  );
}
const optModel = p => m => h('option', { value: m.id, selected: m.id === p?.id }, `${m.ready ? '● ' : '○ '}${m.name} — ${m.maker}`);

// ---------- image generation ----------
async function generate(scene, { quiet = false } = {}) {
  const p = chosenModel(scene);
  if (!p) return toast('No image models loaded', true);
  if (!p.ready) { openSettings(); return toast(`${p.name} needs ${p.keys.join(' + ')}`, true); }
  busy.set(scene.id, 'busy'); renderSceneList(); if (sb.scenes[sel] === scene) renderScenePane();
  try {
    const entry = await api('/api/generate', { method: 'POST', body: { provider: p.id, model: scene.image.model || p.defaultModel, prompt: imagePrompt(sb, scene), aspect: sb.aspect } });
    busy.delete(scene.id);
    const target = sb.scenes.find(s => s.id === scene.id);
    if (target) commit(() => { target.image.src = entry.src; target.image.provider = p.id; target.image.history = [...target.image.history, entry.src]; target.background = 'image'; });
    if (!quiet) toast(`${p.name} · ${(entry.ms / 1000).toFixed(1)}s`);
    return true;
  } catch (err) {
    busy.set(scene.id, 'failed');
    renderSceneList(); if (sb.scenes[sel]?.id === scene.id) renderScenePane();
    toast(err.message, true);
    return false;
  }
}

async function generateAll() {
  const todo = sb.scenes.filter(s => s.background === 'image' && s.image.prompt.trim() && !s.image.src);
  if (!todo.length) return toast(sb.scenes.some(s => s.image.prompt.trim()) ? 'Every image scene already has an image' : 'No scenes have image prompts');
  const p = chosenModel(todo[0]);
  if (!p?.ready) { openSettings(); return toast('Add an image-model key first', true); }
  $('generate-all').disabled = true;
  let done = 0, ok = 0;
  const queue = [...todo];
  const worker = async () => { while (queue.length) { const s = queue.shift(); if (await generate(s, { quiet: true })) ok++; done++; $('generate-all').textContent = `Generating ${done}/${todo.length}…`; } };
  await Promise.all([worker(), worker(), worker()]);
  $('generate-all').disabled = false; $('generate-all').textContent = 'Generate all images';
  toast(`${ok} of ${todo.length} images generated`, ok < todo.length);
}

// ---------- layers pane ----------
function renderLayersPane() {
  const s = sb.scenes[sel];
  const pane = $('pane-layers');
  if (!s) return pane.replaceChildren();
  const rows = s.layers.map((l, k) => {
    const open = l.id === selLayer;
    const summary = l.text || l.title || (l.items && l.items.map(i => i.label || i).join(', ')) || (l.type === 'counter' ? `${l.prefix}${l.to}${l.suffix}` : '');
    return h('div', { class: `layer ${open ? 'sel' : ''}` },
      h('header', { onclick: () => { selLayer = open ? null : l.id; t = sceneStart(sel) + l.start + Math.min(1.2, l.duration * 0.6); renderLayersPane(); renderTimeline(); draw(); } },
        h('b', {}, LABELS[l.type]), h('small', {}, String(summary).replace(/\*/g, '')),
        h('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move up', disabled: k === 0, onclick: e => { e.stopPropagation(); commit(() => { s.layers.splice(k - 1, 0, s.layers.splice(k, 1)[0]); }); } }, '↑'),
        h('button', { class: 'icon danger', title: 'Remove', 'aria-label': 'Remove layer', onclick: e => { e.stopPropagation(); commit(() => { s.layers.splice(k, 1); }); } }, '✕')),
      open && h('div', { class: 'body' }, ...layerFields(s, l)));
  });
  pane.replaceChildren(
    h('div', { class: 'layer-list' }, ...(rows.length ? rows : [h('p', { class: 'empty' }, 'No motion layers on this scene yet.')])),
    h('div', { class: 'group' }, h('h3', {}, 'Add motion'),
      h('div', { class: 'add-layer' }, ...Object.keys(LAYERS).map(type => h('button', {
        title: LAYERS[type].about,
        onclick: () => commit(() => {
          const l = normalizeLayer({ type, ...LAYERS[type].defaults, start: 0.2, duration: s.duration - 0.2 }, s.duration);
          s.layers.push(l); selLayer = l.id;
        })
      }, LABELS[type])))),
    h('p', { class: 'note' }, 'Tip: wrap a word in *stars* to set it in the accent colour and serif.')
  );
}

function layerFields(s, l) {
  const def = LAYERS[l.type];
  const out = [];
  for (const [k, d] of Object.entries(def.defaults)) {
    if (k === 'position' || k === 'reveal' || k === 'style' || k === 'size') continue;
    if (Array.isArray(d) && typeof d[0] === 'object') {
      out.push(field('Items (label: value per line)', text(l[k].map(i => `${i.label}: ${i.value}`).join('\n'), live(v => {
        l[k] = v.split('\n').map(r => r.trim()).filter(Boolean).slice(0, 6).map(r => { const m = r.match(/^(.*?)[:=]\s*(-?[\d.,]+)\s*$/); return m ? { label: m[1].trim(), value: Number(m[2].replace(/,/g, '')) } : { label: r, value: 0 }; });
      }), { area: true, rows: 4 })));
    } else if (Array.isArray(d)) {
      out.push(field('Items (one per line)', text(l[k].join('\n'), live(v => { l[k] = v.split('\n').map(r => r.trim()).filter(Boolean).slice(0, 6); }), { area: true, rows: 4 })));
    } else if (typeof d === 'number') {
      out.push(field(k[0].toUpperCase() + k.slice(1), number(l[k], v => commit(() => { l[k] = v; }), { step: k === 'size' || k === 'strength' ? 0.05 : 1 })));
    } else {
      const long = k === 'text' && l.type !== 'logo' && l.type !== 'kicker' && l.type !== 'cta';
      out.push(field(k[0].toUpperCase() + k.slice(1), text(l[k], live(v => { l[k] = v; }), { area: long, rows: 2 })));
    }
  }
  const row = [];
  if ('position' in def.defaults) row.push(field('Position', select(l.position, POSITIONS, v => commit(() => { l.position = v; }))));
  if (def.reveals) row.push(field('Reveal', select(l.reveal, def.reveals, v => commit(() => { l.reveal = v; }))));
  if (def.styles) row.push(field('Style', select(l.style, def.styles, v => commit(() => { l.style = v; }))));
  if (l.type === 'headline') row.push(field('Size', select(l.size, ['xl', 'l', 'm'], v => commit(() => { l.size = v; }), { xl: 'Huge', l: 'Large', m: 'Medium' })));
  if (row.length) out.push(h('div', { class: 'field-row' }, ...row));
  out.push(h('div', { class: 'field-row' },
    field('Starts at (s)', number(l.start, v => commit(() => { l.start = v; }), { min: 0, max: s.duration })),
    field('Lasts (s)', number(l.duration, v => commit(() => { l.duration = v; }), { min: 0.3, max: s.duration }))));
  return out;
}

// ---------- style pane ----------
const PALETTES = [
  { bg: '#0b0b0d', ink: '#f4f2ee', accent: '#ff5b1f', muted: '#8f8c86' },
  { bg: '#f3f1ec', ink: '#111111', accent: '#1f4bff', muted: '#6e6b66' },
  { bg: '#05070d', ink: '#e8f0ff', accent: '#5ef0c0', muted: '#7d8aa6' },
  { bg: '#140a1f', ink: '#fbefff', accent: '#ff3ea5', muted: '#a58db8' },
  { bg: '#0f1410', ink: '#eef3e6', accent: '#c8ff3a', muted: '#8a9a83' },
  { bg: '#1a1410', ink: '#fbf3e6', accent: '#ffb547', muted: '#a99883' },
  { bg: '#000000', ink: '#ffffff', accent: '#ffffff', muted: '#888888' },
  { bg: '#0c1a2b', ink: '#f2f6fb', accent: '#ff6a4d', muted: '#8ea2b8' }
];
function renderStylePane() {
  const st = sb.style;
  const color = k => h('label', {}, k, h('input', { type: 'color', value: st.palette[k], oninput: e => live(v => { st.palette[k] = v; })(e.target.value, false), onchange: e => live(v => { st.palette[k] = v; })(e.target.value, true) }));
  $('pane-style').replaceChildren(
    h('div', { class: 'group' }, h('h3', {}, 'Palette'),
      h('div', { class: 'presets' }, ...PALETTES.map(p => h('button', { title: 'Use palette', 'aria-label': 'Use palette', onclick: () => commit(() => { st.palette = { ...p }; }) },
        h('span', { style: { background: p.bg } }), h('span', { style: { background: p.ink } }), h('span', { style: { background: p.accent } })))),
      h('div', { class: 'colors' }, color('bg'), color('ink'), color('accent'), color('muted'))),
    h('div', { class: 'group' }, h('h3', {}, 'Type'),
      h('div', { class: 'field-row' },
        field('Main font', select(st.font, FONTS, v => commit(() => { st.font = v; }))),
        field('Accent font', select(st.accentFont, FONTS, v => commit(() => { st.accentFont = v; }))))),
    h('div', { class: 'group' }, h('h3', {}, 'Finish'),
      field('Film grain', h('input', { type: 'range', min: 0, max: 0.3, step: 0.01, value: st.grain, oninput: e => live(v => { st.grain = v; })(Number(e.target.value), false), onchange: e => live(v => { st.grain = v; })(Number(e.target.value), true) })),
      field('Vignette', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.vignette, oninput: e => live(v => { st.vignette = v; })(Number(e.target.value), false), onchange: e => live(v => { st.vignette = v; })(Number(e.target.value), true) })),
      field('Frame rate', select(String(sb.fps), ['24', '25', '30', '60'], v => commit(() => { sb.fps = Number(v); })))),
    h('div', { class: 'group' }, h('h3', {}, 'Image look'),
      field('Added to every image prompt', text(st.imageStyle, live(v => { st.imageStyle = v; }), { area: true, rows: 3, placeholder: 'e.g. shot on 35mm, dawn light, teal and amber grade' }))),
    h('div', { class: 'group' }, h('h3', {}, 'Music'),
      sb.music ? h('div', { class: 'btns' }, h('span', { class: 'muted' }, sb.music.name), h('button', { class: 'danger', onclick: () => commit(() => { sb.music = null; }) }, 'Remove')) : h('p', { class: 'note' }, 'Optional. Mixed in with fades on export.'),
      sb.music && field('Volume', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: sb.music.volume, onchange: e => commit(() => { sb.music.volume = Number(e.target.value); }) })),
      h('button', { onclick: () => $('file-audio').click() }, sb.music ? 'Replace music' : 'Add music'))
  );
}

// ---------- settings ----------
async function loadProviders() {
  providers = await api('/api/providers');
  const dirSel = $('director');
  const want = store.get('genmotion:director', providers.preferredDirector || '');
  const ready = providers.director.filter(d => d.ready);
  dirSel.replaceChildren(
    h('option', { value: '' }, ready.length ? `Auto (${ready[0].name})` : 'Offline planner'),
    ...providers.director.map(d => h('option', { value: d.id, disabled: !d.ready, selected: d.id === want && d.ready }, `${d.name}${d.ready ? '' : ' — no key'}`)));
  const anyImage = providers.image.some(p => p.ready);
  $('key-dot').className = `dot ${anyImage && ready.length ? 'ok' : anyImage || ready.length ? 'warn' : ''}`;
}

function openSettings() {
  const groups = [
    ['Image models — global', providers.image.filter(p => p.region === 'global' && !p.freeModel)],
    ['Image models — China', providers.image.filter(p => p.region === 'china')],
    ['One key, every model', providers.image.filter(p => p.freeModel)],
    ['Directors (text models that write the storyboard)', providers.director]
  ];
  const keyInfo = Object.fromEntries(providers.keys.map(k => [k.name, k]));
  const seen = new Set();
  $('key-groups').replaceChildren(...groups.map(([title, list]) => h('div', { class: 'key-group' }, h('h3', {}, title),
    ...list.map(p => {
      const fresh = p.keys.filter(k => !seen.has(k)); p.keys.forEach(k => seen.add(k));
      const editors = fresh.map(k => {
        const input = h('input', { type: 'password', placeholder: keyInfo[k]?.set ? `${k} saved ${keyInfo[k].hint}` : k, autocomplete: 'off', spellcheck: false, 'aria-label': k });
        return h('div', { class: 'key-edit' }, input,
          h('button', { onclick: async () => { await saveKey(k, input.value); } }, 'Save'),
          keyInfo[k]?.set && h('button', { class: 'danger', onclick: async () => { await saveKey(k, ''); } }, 'Clear'));
      });
      const shared = p.keys.filter(k => !fresh.includes(k));
      return h('div', { class: 'key-row' },
        h('span', { class: `dot ${p.ready ? 'ok' : ''}` }),
        h('div', { class: 'who' }, `${p.name}`, h('small', {}, `${p.maker}${p.strengths ? ` · ${p.strengths}` : ''}${shared.length ? ` · uses ${shared.join(' + ')} from above` : ''}`)),
        p.signup ? h('a', { class: 'button', href: p.signup, target: '_blank', rel: 'noopener' }, 'Get key') : h('span'),
        ...editors);
    }))));
  if (!$('settings').open) $('settings').showModal();
}
async function saveKey(name, value) {
  try {
    providers = await api('/api/keys', { method: 'POST', body: { name, value } });
    await loadProviders(); openSettings(); renderInspector();
    toast(value ? `${name} saved` : `${name} cleared`);
  } catch (err) { toast(err.message, true); }
}

// ---------- library ----------
async function openLibrary() {
  const grid = $('library-grid');
  grid.replaceChildren(h('p', { class: 'note' }, 'Loading…'));
  if (!$('library').open) $('library').showModal();
  try {
    const rows = await api('/api/library');
    grid.replaceChildren(...(rows.length ? rows.map(r => h('button', {
      class: 'tile', title: r.prompt,
      onclick: () => { const s = sb.scenes[sel]; commit(() => { s.image.src = r.src; s.background = 'image'; if (!s.image.history.includes(r.src)) s.image.history.push(r.src); }); $('library').close(); }
    }, h('div', { class: 'img', style: { backgroundImage: `url("${r.src}")` } }), h('div', { class: 'cap' }, h('b', {}, r.providerName || r.provider), ` · ${r.prompt}`))) : [h('p', { class: 'empty' }, 'Nothing here yet. Generated and uploaded images land here.')]));
  } catch (err) { grid.replaceChildren(h('p', { class: 'note warn' }, err.message)); }
}

// ---------- projects ----------
async function openProjects() {
  const list = $('project-list');
  if (!$('projects').open) $('projects').showModal();
  try {
    const rows = await api('/api/projects');
    list.replaceChildren(...rows.map(r => h('li', {}, h('button', { onclick: () => loadProject(r.id) },
      h('span', {}, r.title || 'Untitled', r.id === projectId ? h('span', { class: 'muted' }, ' · open') : ''),
      h('span', { class: 'muted' }, `${r.scenes} scenes · ${new Date(r.saved).toLocaleString()}`)))));
  } catch (err) { list.replaceChildren(h('li', { class: 'note warn' }, err.message)); }
}
async function loadProject(id) {
  try {
    const p = await api(`/api/projects/${id}`);
    projectId = id; store.set('genmotion:projectId', id);
    sb = normalize(p.storyboard); sel = 0; t = 0; undo.length = 0; redo.length = 0;
    changed(); $('projects').close();
  } catch (err) { toast(err.message, true); }
}
$('new-project').onclick = () => {
  projectId = uid('p').toLowerCase().replace(/[^a-z0-9]/g, ''); store.set('genmotion:projectId', projectId);
  sb = normalize({ title: 'Untitled', aspect: sb.aspect, scenes: [{ name: 'Scene 1', background: 'gradient', layers: [{ type: 'headline', text: 'Your *idea* here' }] }] });
  sel = 0; t = 0; changed(); $('projects').close(); $('idea').focus();
};
$('export-json').onclick = () => download(new Blob([JSON.stringify(sb, null, 2)], { type: 'application/json' }), `${slug(sb.title)}.genmotion.json`);
$('import-json').onclick = () => $('file-json').click();
$('file-json').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { const raw = JSON.parse(await f.text()); commit(() => { sb = normalize(raw.storyboard || raw); sel = 0; t = 0; }); $('projects').close(); toast('Project opened'); }
  catch { toast('That file is not a GenMotion project', true); }
};

// ---------- uploads ----------
let uploadTarget = null;
$('file-image').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !uploadTarget) return;
  const s = uploadTarget; uploadTarget = null;
  try {
    const entry = await api('/api/upload', { method: 'POST', body: f, headers: { 'content-type': f.type, 'x-file-name': encodeURIComponent(f.name) } });
    commit(() => { s.image.src = entry.src; s.background = 'image'; s.image.history.push(entry.src); });
  } catch (err) { toast(err.message, true); }
};
$('file-audio').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const entry = await api('/api/upload', { method: 'POST', body: f, headers: { 'content-type': f.type || 'audio/mpeg', 'x-file-name': encodeURIComponent(f.name) } });
    commit(() => { sb.music = { src: entry.src, name: entry.name, volume: 0.8 }; });
  } catch (err) { toast(err.message, true); }
};
$('viewer').addEventListener('dragover', e => e.preventDefault());
$('viewer').addEventListener('drop', e => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
  if (!f) return;
  uploadTarget = sb.scenes[sel];
  const dt = new DataTransfer(); dt.items.add(f); $('file-image').files = dt.files; $('file-image').dispatchEvent(new Event('change'));
});

// ---------- export ----------
const slug = s => (s || 'genmotion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'genmotion';
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
let exportCtl = null;
$('export').onclick = async () => {
  if (!canExport()) return toast('Export needs Chrome or Edge (WebCodecs)', true);
  setPlaying(false);
  const dlg = $('exporting'), save = $('export-save');
  save.hidden = true; $('export-cancel').textContent = 'Cancel'; $('export-bar').style.width = '0%';
  $('export-status').textContent = 'Loading images and fonts…';
  dlg.showModal();
  exportCtl = new AbortController();
  try {
    await preloadAll();
    await Promise.all([sb.style.font, sb.style.accentFont].map(f => document.fonts.load(`700 100px "${f}"`).catch(() => {})));
    await document.fonts.load(`italic 400 100px "${sb.style.accentFont}"`).catch(() => {});
    const started = performance.now();
    const blob = await exportMp4(sb, {
      image, signal: exportCtl.signal,
      onProgress: (p, msg) => { $('export-bar').style.width = `${(p * 100).toFixed(1)}%`; $('export-status').textContent = msg; }
    });
    const name = `${slug(sb.title)}.mp4`;
    save.href = URL.createObjectURL(blob); save.download = name; save.hidden = false;
    $('export-status').textContent = `${(blob.size / 1e6).toFixed(1)} MB · ${size(sb).width}×${size(sb).height} · ${sb.fps} fps · rendered in ${((performance.now() - started) / 1000).toFixed(1)}s`;
    $('export-cancel').textContent = 'Close';
    window.__lastExport = blob;
    save.click();
  } catch (err) {
    $('export-status').textContent = err.message; $('export-cancel').textContent = 'Close';
  }
};
$('export-cancel').onclick = () => { exportCtl?.abort(); $('exporting').close(); };

// ---------- director ----------
async function directIt() {
  const prompt = $('idea').value.trim();
  if (!prompt) { $('idea').focus(); return toast('Write an idea first'); }
  const btn = $('direct');
  btn.disabled = true; btn.textContent = 'Directing…';
  $('direct-note').hidden = true;
  try {
    const res = await api('/api/direct', { method: 'POST', body: { prompt, aspect: $('aspect').value, mode, director: $('director').value || undefined, scenes: $('scene-count').value || undefined } });
    commit(() => { sb = res.storyboard; sel = 0; t = 0; selLayer = null; });
    $('direct-note').textContent = res.note || `Directed by ${res.director}. ${mode === 'images' ? 'Next: Generate all images.' : ''}`;
    $('direct-note').hidden = false;
    setPlaying(true);
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Write storyboard'; }
}

// ---------- wiring ----------
$('direct').onclick = directIt;
$('idea').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) directIt(); });
$('idea').value = store.get('genmotion:idea', '');
$('idea').addEventListener('input', () => store.set('genmotion:idea', $('idea').value));
$('generate-all').onclick = generateAll;
$('director').onchange = e => store.set('genmotion:director', e.target.value);
for (const b of document.querySelectorAll('.seg button')) b.onclick = () => {
  mode = b.dataset.mode;
  for (const x of document.querySelectorAll('.seg button')) x.setAttribute('aria-checked', String(x === b));
  $('generate-all').hidden = mode === 'motion';
};
$('aspect').onchange = e => commit(() => { sb.aspect = e.target.value; });
$('title').onchange = e => commit(() => { sb.title = e.target.value.trim() || 'Untitled'; });
$('add-scene').onclick = () => commit(() => {
  sb.scenes.splice(sel + 1, 0, normalizeScene({ name: `Scene ${sb.scenes.length + 1}`, background: 'gradient', transition: { type: 'fade', duration: 0.5 }, layers: [{ type: 'headline', text: 'New *scene*', start: 0.2, duration: 3.6 }] }, sel + 1));
  sel++;
});
$('play').onclick = () => setPlaying(!playing);
$('loop').onclick = () => { loop = !loop; $('loop').classList.toggle('on', loop); $('loop').setAttribute('aria-pressed', String(loop)); };
$('scrub').oninput = e => { setPlaying(false); t = Number(e.target.value); draw(); };
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => { tab = b.dataset.tab; renderInspector(); };
$('open-settings').onclick = openSettings;
$('open-library').onclick = openLibrary;
$('open-projects').onclick = openProjects;
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? step(redo, undo) : step(undo, redo); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); step(redo, undo); return; }
  if (typing) return;
  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); t = Math.max(0, t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / sb.fps)); draw(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); seekScene(Math.max(0, Math.min(sb.scenes.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)))); }
});
new ResizeObserver(() => draw()).observe($('track'));

// Test hook: lets headless checks drive the studio without clicking.
window.genmotion = { get storyboard() { return sb; }, set storyboard(v) { sb = normalize(v); sel = 0; changed(); }, seek: v => { t = v; draw(); }, exportMp4: () => exportMp4(sb, { image }), preloadAll };

renderAll(); draw();
requestAnimationFrame(tick);
if (!saved) fetch('demo.genmotion.json').then(r => r.json()).then(demo => { sb = normalize(demo); sel = 0; t = 0; renderAll(); draw(); }).catch(() => {});
loadProviders().then(renderInspector).catch(err => toast(`Server not reachable: ${err.message}`, true));
document.fonts.ready.then(draw);

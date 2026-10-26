// The director turns one idea into a storyboard: scenes, image prompts, motion layers,
// camera moves and transitions. Any configured text model can direct; with no key at all a
// simple offline planner still produces an editable storyboard.
import { LAYERS, CAMERA_MOVES, TRANSITIONS, BACKGROUNDS, FONTS, POSITIONS, normalize } from '../web/engine/storyboard.mjs';
import { LLMS, llm, directorModel } from './providers/llm/index.mjs';
import { env } from './env.mjs';

export function systemPrompt({ mode }) {
  const layerDocs = Object.entries(LAYERS).map(([type, def]) => {
    const extra = def.reveals ? ` reveal: ${def.reveals.join('|')}.` : def.styles ? ` style: ${def.styles.join('|')}.` : '';
    return `- ${type}: ${def.about} Fields: ${JSON.stringify(def.defaults)}.${extra}`;
  }).join('\n');
  return `You are the director of GenMotion, a tool that makes short, premium motion-graphics videos.
Turn the user's idea into a storyboard JSON. Reply with JSON only, no prose, no code fences.

Schema:
{
  "title": string,
  "aspect": "16:9" | "9:16" | "1:1",
  "style": {
    "palette": { "bg": "#hex", "ink": "#hex", "accent": "#hex", "muted": "#hex" },
    "font": ${FONTS.map(f => `"${f}"`).join(' | ')},
    "accentFont": same choices (used for *starred* words),
    "grain": 0-0.3, "vignette": 0-1,
    "imageStyle": "one shared look appended to every image prompt (film stock, lens, light, grade)"
  },
  "scenes": [{
    "name": "2-3 word label",
    "duration": seconds (1.5-8),
    "background": ${BACKGROUNDS.map(b => `"${b}"`).join(' | ')},
    "image": { "prompt": "what the image model should paint" },
    "camera": { "move": ${CAMERA_MOVES.map(m => `"${m}"`).join(' | ')}, "amount": 0-1 },
    "dim": 0-0.9 (darken the image so text reads),
    "transition": { "type": ${TRANSITIONS.map(t => `"${t}"`).join(' | ')}, "duration": 0.2-1.2 },
    "layers": [ { "type": ..., "start": seconds from scene start, "duration": seconds, ...fields } ]
  }]
}
Positions: ${POSITIONS.join(', ')}.

Layer types:
${layerDocs}

Direction rules:
- Pacing like a high-end launch film: 4-8 scenes, most 2.5-5 s. Open strong, end on a logo or cta card.
- Text is short. Headlines 2-6 words, one idea per scene. Use *stars* on the one word that matters.
- 1-3 layers per scene. Don't stack two big text layers in the same position; pair headline (center) with subtitle (bottom) or kicker (top-left).
- Vary reveals, camera moves and transitions; use "cut" for punch, "fade"/"blur" for calm, "flash"/"zoom" for energy.
- Keep layers inside the scene: start + duration <= scene duration.
- Palette: dark bg + light ink unless the idea calls for light. One saturated accent.
${mode === 'motion'
    ? '- MOTION-ONLY: no images. Every scene uses background "gradient", "grid" or "solid" and image.prompt is "".'
    : `- Every image scene gets a concrete visual prompt: subject, setting, light, lens, composition, mood. Leave calm negative space where the text sits (say where). Never ask for text, letters or logos in the image.
- imageStyle keeps every frame consistent (same grade, lens, era). Scenes that are pure typography may use "gradient" or "grid" instead of an image.`}`;
}

export function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
  throw new Error('The director did not return JSON');
}

export function pickDirector(requested) {
  if (requested) {
    const p = llm(requested);
    if (!p) throw new Error(`Unknown director ${requested}`);
    if (!p.keys.every(k => env(k))) throw new Error(`${p.name} needs ${p.keys.join(' + ')} in Settings`);
    return p;
  }
  const preferred = env('GENMOTION_DIRECTOR');
  return (preferred && llm(preferred) && llm(preferred).keys.every(k => env(k)) && llm(preferred))
    || LLMS.find(p => p.keys.every(k => env(k))) || null;
}

export async function direct({ prompt, aspect = '16:9', mode = 'images', director, model, scenes, signal, fetch }) {
  const idea = String(prompt || '').trim();
  if (!idea) throw new Error('Write an idea first');
  const p = pickDirector(director);
  if (!p) return { storyboard: offlinePlan({ prompt: idea, aspect, mode }), director: 'offline', note: 'No text-model key set, so a simple offline planner wrote this. Add any key in Settings for a real director.' };
  const user = [
    `Idea: ${idea}`,
    `Aspect: ${aspect}`,
    scenes ? `Scenes: about ${scenes}` : '',
    mode === 'motion' ? 'Mode: motion graphics only (no images).' : 'Mode: generated images + motion graphics.'
  ].filter(Boolean).join('\n');
  const text = await p.chat({ system: systemPrompt({ mode }), user, model: model || directorModel(p), signal, fetch }, { key: env });
  const raw = parseJson(text);
  raw.aspect = aspect;
  const storyboard = normalize(raw);
  if (mode === 'motion') for (const s of storyboard.scenes) { s.image.prompt = ''; if (s.background === 'image') s.background = 'gradient'; }
  return { storyboard, director: `${p.name} · ${model || directorModel(p)}` };
}

// Keyless fallback: splits the idea into beats and lays out a clean, varied storyboard.
export function offlinePlan({ prompt, aspect = '16:9', mode = 'images' }) {
  const beats = prompt.split(/(?<=[.!?])\s+|\s*[;\n]+\s*|\s+(?:then|and then)\s+/i).map(s => s.trim()).filter(Boolean).slice(0, 5);
  if (beats.length < 2) beats.push('Made with GenMotion');
  const title = beats[0].split(/\s+/).slice(0, 5).join(' ');
  const brand = (prompt.match(/\b([A-Z][a-zA-Z0-9]+)\b/) || [])[1] || title.split(' ')[0];
  const reveals = ['rise', 'blur', 'mask', 'split', 'scale'];
  const moves = ['push', 'pan-left', 'drift', 'pull', 'rise'];
  const trans = ['cut', 'blur', 'wipe', 'zoom', 'fade', 'flash'];
  const short = s => s.replace(/[.!?]+$/, '').split(/\s+/).slice(0, 6).join(' ');
  const accent = s => { const w = s.split(' '); w[w.length - 1] = `*${w[w.length - 1]}*`; return w.join(' '); };
  const scenes = beats.map((beat, i) => ({
    name: short(beat).split(' ').slice(0, 2).join(' '),
    duration: 3.6,
    background: mode === 'motion' ? (i % 2 ? 'grid' : 'gradient') : 'image',
    image: { prompt: mode === 'motion' ? '' : `${beat}, cinematic wide shot, calm negative space in the center for a title` },
    camera: { move: moves[i % moves.length], amount: 0.5 },
    dim: 0.45,
    transition: { type: trans[i % trans.length], duration: 0.6 },
    layers: [
      { type: 'kicker', text: `${String(i + 1).padStart(2, '0')} / ${String(beats.length).padStart(2, '0')}`, position: 'top-left', start: 0.1, duration: 3.4 },
      { type: 'headline', text: accent(short(beat)), size: 'l', reveal: reveals[i % reveals.length], position: 'center', start: 0.2, duration: 3.3 }
    ]
  }));
  scenes.push({
    name: 'End card', duration: 3.2, background: 'gradient', transition: { type: 'dip', duration: 0.6 },
    layers: [{ type: 'logo', text: `${brand.toLowerCase()}.`, start: 0.1, duration: 3 }, { type: 'subtitle', text: title, position: 'bottom', start: 0.9, duration: 2.2 }]
  });
  return normalize({ title, aspect, style: { imageStyle: 'shot on 35mm film, soft contrast, natural light, shallow depth of field' }, scenes });
}

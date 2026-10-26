// Provider registry. Adding a model = one file in ./image exporting { id, name, keys, models,
// defaultModel, generate() } and one line below.
import { env, mask } from '../env.mjs';
import openai from './image/openai.mjs';
import gemini from './image/gemini.mjs';
import imagen from './image/imagen.mjs';
import flux from './image/flux.mjs';
import ideogram from './image/ideogram.mjs';
import recraft from './image/recraft.mjs';
import stability from './image/stability.mjs';
import xai from './image/xai.mjs';
import seedream from './image/seedream.mjs';
import { qwen, wan } from './image/dashscope.mjs';
import kling from './image/kling.mjs';
import cogview from './image/cogview.mjs';
import minimax from './image/minimax.mjs';
import hunyuan from './image/hunyuan.mjs';
import fal from './image/fal.mjs';
import replicate from './image/replicate.mjs';
import { LLMS } from './llm/index.mjs';

export const IMAGE_PROVIDERS = [
  seedream, openai, gemini, imagen, flux, qwen, kling, ideogram, recraft, wan, hunyuan, cogview, minimax, stability, xai, fal, replicate
];

export const imageProvider = id => IMAGE_PROVIDERS.find(p => p.id === id);

export function ready(provider) {
  return provider.keys.every(k => env(k));
}

// Every distinct env var any provider reads, for the Settings panel.
export function keyCatalog() {
  const rows = new Map();
  for (const p of [...IMAGE_PROVIDERS, ...LLMS]) {
    for (const k of p.keys) {
      const row = rows.get(k) || { name: k, used: [], signup: p.signup };
      row.used.push(p.name);
      rows.set(k, row);
    }
  }
  return [...rows.values()].map(r => ({ ...r, set: !!env(r.name), hint: mask(env(r.name)) }));
}

export function describe(p) {
  return {
    id: p.id, name: p.name, maker: p.maker, region: p.region, keys: p.keys, signup: p.signup,
    models: p.models, defaultModel: p.defaultModel, freeModel: !!p.freeModel, strengths: p.strengths, ready: ready(p)
  };
}

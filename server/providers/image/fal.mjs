import { request, SIZES, firstUrl, ProviderError } from '../util.mjs';

// fal.ai hosts hundreds of models behind one key, including open-weight Chinese models
// (Hunyuan Image, Qwen-Image, Seedream) — the easiest way to try many models at once.
export default {
  id: 'fal', name: 'fal.ai (any model)', maker: 'fal', region: 'global',
  keys: ['FAL_KEY'], signup: 'https://fal.ai/dashboard/keys',
  models: [
    'fal-ai/flux-pro/v1.1-ultra', 'fal-ai/flux/dev',
    'fal-ai/bytedance/seedream/v4/text-to-image', 'fal-ai/qwen-image',
    'fal-ai/hunyuan-image/v3/text-to-image', 'fal-ai/imagen4/preview',
    'fal-ai/recraft/v3/text-to-image', 'fal-ai/ideogram/v3'
  ],
  defaultModel: 'fal-ai/flux-pro/v1.1-ultra', freeModel: true,
  strengths: 'One key, every model. Type any fal model id.',
  async generate({ prompt, aspect, model, negative, seed }, { key, signal, fetch }) {
    const json = { prompt, image_size: SIZES.falPreset[aspect], aspect_ratio: aspect, num_images: 1 };
    if (negative) json.negative_prompt = negative;
    if (seed != null) json.seed = seed;
    const data = await request(this.name, `https://fal.run/${model}`, {
      method: 'POST', signal, fetch, timeout: 300_000, headers: { authorization: `Key ${key('FAL_KEY')}` }, json
    });
    const url = firstUrl(data.images) || firstUrl(data.image);
    if (!url) throw new ProviderError(this.name, 'no image in response');
    return { url };
  }
};

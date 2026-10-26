import { request, ProviderError } from '../util.mjs';

export default {
  id: 'stability', name: 'Stable Image', maker: 'Stability AI', region: 'global',
  keys: ['STABILITY_API_KEY'], signup: 'https://platform.stability.ai/account/keys',
  models: ['ultra', 'core', 'sd3'], defaultModel: 'ultra',
  strengths: 'Open-weight lineage, flexible styles.',
  async generate({ prompt, aspect, model, negative, seed }, { key, signal, fetch }) {
    const form = new FormData();
    form.set('prompt', prompt);
    form.set('aspect_ratio', aspect);
    form.set('output_format', 'png');
    if (negative) form.set('negative_prompt', negative);
    if (seed != null) form.set('seed', String(seed));
    const res = await request(this.name, `https://api.stability.ai/v2beta/stable-image/generate/${model}`, {
      method: 'POST', signal, fetch, raw: true, body: form,
      headers: { authorization: `Bearer ${key('STABILITY_API_KEY')}`, accept: 'image/*' }
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new ProviderError(this.name, 'empty image');
    return { buffer, mime: res.headers.get('content-type') || 'image/png' };
  }
};

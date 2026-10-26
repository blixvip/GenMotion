import { request, SIZES, ProviderError } from '../util.mjs';

export default {
  id: 'ideogram', name: 'Ideogram 3.0', maker: 'Ideogram', region: 'global',
  keys: ['IDEOGRAM_API_KEY'], signup: 'https://ideogram.ai/manage-api',
  models: ['V_3'], defaultModel: 'V_3',
  strengths: 'Typography, posters and logos.',
  async generate({ prompt, aspect, negative, seed }, { key, signal, fetch }) {
    const form = new FormData();
    form.set('prompt', prompt);
    form.set('aspect_ratio', SIZES.ideogram[aspect]);
    form.set('rendering_speed', 'DEFAULT');
    if (negative) form.set('negative_prompt', negative);
    if (seed != null) form.set('seed', String(seed));
    const data = await request(this.name, 'https://api.ideogram.ai/v1/ideogram-v3/generate', {
      method: 'POST', signal, fetch, headers: { 'Api-Key': key('IDEOGRAM_API_KEY') }, body: form
    });
    const url = data.data?.[0]?.url;
    if (!url) throw new ProviderError(this.name, 'no image in response');
    return { url };
  }
};

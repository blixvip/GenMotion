import { request, SIZES, ProviderError } from '../util.mjs';

export default {
  id: 'recraft', name: 'Recraft V3', maker: 'Recraft', region: 'global',
  keys: ['RECRAFT_API_KEY'], signup: 'https://www.recraft.ai/profile/api',
  models: ['recraftv3'], defaultModel: 'recraftv3',
  strengths: 'Design-grade illustration, icons and brand-consistent styles.',
  async generate({ prompt, aspect, model }, { key, signal, fetch }) {
    const data = await request(this.name, 'https://external.api.recraft.ai/v1/images/generations', {
      method: 'POST', signal, fetch, headers: { authorization: `Bearer ${key('RECRAFT_API_KEY')}` },
      json: { prompt, model, style: 'realistic_image', size: SIZES.recraft[aspect], n: 1 }
    });
    const url = data.data?.[0]?.url;
    if (!url) throw new ProviderError(this.name, 'no image in response');
    return { url };
  }
};

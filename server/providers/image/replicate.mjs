import { request, poll, firstUrl, ProviderError } from '../util.mjs';

export default {
  id: 'replicate', name: 'Replicate (any model)', maker: 'Replicate', region: 'global',
  keys: ['REPLICATE_API_TOKEN'], signup: 'https://replicate.com/account/api-tokens',
  models: ['black-forest-labs/flux-1.1-pro', 'bytedance/seedream-4', 'qwen/qwen-image', 'google/imagen-4', 'ideogram-ai/ideogram-v3-turbo'],
  defaultModel: 'black-forest-labs/flux-1.1-pro', freeModel: true,
  strengths: 'One key, thousands of community models. Type any owner/name.',
  async generate({ prompt, aspect, model, seed }, { key, signal, fetch }) {
    const headers = { authorization: `Bearer ${key('REPLICATE_API_TOKEN')}` };
    const input = { prompt, aspect_ratio: aspect, output_format: 'png' };
    if (seed != null) input.seed = seed;
    let p = await request(this.name, `https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST', signal, fetch, headers: { ...headers, prefer: 'wait=60' }, json: { input }
    });
    if (p.status !== 'succeeded') {
      p = await poll(this.name, async () => {
        const r = await request(this.name, p.urls?.get || `https://api.replicate.com/v1/predictions/${p.id}`, { signal, fetch, headers });
        if (r.status === 'succeeded') return r;
        if (r.status === 'failed' || r.status === 'canceled') throw new ProviderError(this.name, r.error || r.status);
      }, { signal });
    }
    const url = firstUrl(p.output);
    if (!url) throw new ProviderError(this.name, 'no image in output');
    return { url };
  }
};

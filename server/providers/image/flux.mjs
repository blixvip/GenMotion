import { request, poll, SIZES, ProviderError } from '../util.mjs';

// Black Forest Labs: submit, then poll the returned polling_url until the sample is ready.
export default {
  id: 'flux', name: 'FLUX', maker: 'Black Forest Labs', region: 'global',
  keys: ['BFL_API_KEY'], signup: 'https://dashboard.bfl.ai/',
  models: ['flux-pro-1.1', 'flux-pro-1.1-ultra', 'flux-kontext-pro', 'flux-kontext-max'], defaultModel: 'flux-pro-1.1',
  strengths: 'Cinematic photoreal looks, great skin and lighting.',
  async generate({ prompt, aspect, model, seed }, { key, signal, fetch }) {
    const headers = { 'x-key': key('BFL_API_KEY'), accept: 'application/json' };
    const [width, height] = SIZES.multiple32[aspect];
    // flux-pro-1.1 takes pixel sizes; ultra and kontext take an aspect ratio.
    const json = model === 'flux-pro-1.1' ? { prompt, width, height, seed } : { prompt, aspect_ratio: aspect, seed };
    const job = await request(this.name, `https://api.bfl.ai/v1/${model}`, { method: 'POST', signal, fetch, headers, json });
    const url = job.polling_url || `https://api.bfl.ai/v1/get_result?id=${job.id}`;
    const sample = await poll(this.name, async () => {
      const r = await request(this.name, url, { signal, fetch, headers });
      if (r.status === 'Ready') return r.result?.sample;
      if (/error|moderated|not found/i.test(r.status || '')) throw new ProviderError(this.name, r.status);
    }, { signal });
    return { url: sample };
  }
};

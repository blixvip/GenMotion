import { request, dataUrlToImage, ProviderError } from '../util.mjs';

export default {
  id: 'xai', name: 'Grok Imagine', maker: 'xAI', region: 'global',
  keys: ['XAI_API_KEY'], signup: 'https://console.x.ai/',
  models: ['grok-2-image-1212'], defaultModel: 'grok-2-image-1212',
  strengths: 'Loose, punchy, few refusals.',
  async generate({ prompt, model }, { key, signal, fetch }) {
    const data = await request(this.name, 'https://api.x.ai/v1/images/generations', {
      method: 'POST', signal, fetch, headers: { authorization: `Bearer ${key('XAI_API_KEY')}` },
      json: { model, prompt, n: 1, response_format: 'b64_json' }
    });
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError(this.name, 'no image in response');
    return dataUrlToImage(b64, 'image/jpeg');
  }
};

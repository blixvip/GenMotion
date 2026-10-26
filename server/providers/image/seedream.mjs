import { request, SIZES, ProviderError } from '../util.mjs';

// ByteDance Seedream via BytePlus ModelArk (international). For mainland Volcengine Ark set
// ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 and use the doubao-seedream-* model id.
export default {
  id: 'seedream', name: 'Seedream 4.0', maker: 'ByteDance', region: 'china',
  keys: ['ARK_API_KEY'], signup: 'https://console.byteplus.com/ark',
  models: ['seedream-4-0-250828', 'doubao-seedream-4-0-250828'], defaultModel: 'seedream-4-0-250828',
  strengths: 'Top of the image leaderboards; 2K-4K output, sharp text, great faces.',
  async generate({ prompt, aspect, model, seed }, { key, signal, fetch }) {
    const base = process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';
    const json = { model, prompt, size: SIZES.seedream[aspect], response_format: 'url', watermark: false };
    if (seed != null) json.seed = seed;
    const data = await request(this.name, `${base}/images/generations`, {
      method: 'POST', signal, fetch, timeout: 180_000, headers: { authorization: `Bearer ${key('ARK_API_KEY')}` }, json
    });
    const url = data.data?.[0]?.url;
    if (!url) throw new ProviderError(this.name, 'no image in response');
    return { url };
  }
};

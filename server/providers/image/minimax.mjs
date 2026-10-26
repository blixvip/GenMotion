import { request, ProviderError } from '../util.mjs';

// MiniMax (Hailuo). Mainland accounts set MINIMAX_BASE_URL=https://api.minimaxi.com.
export default {
  id: 'minimax', name: 'MiniMax Image-01', maker: 'MiniMax', region: 'china',
  keys: ['MINIMAX_API_KEY'], signup: 'https://www.minimax.io/platform',
  models: ['image-01'], defaultModel: 'image-01',
  strengths: 'Cheap, consistent characters; pairs with Hailuo video.',
  async generate({ prompt, aspect, model }, { key, signal, fetch }) {
    const base = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io';
    const data = await request(this.name, `${base}/v1/image_generation`, {
      method: 'POST', signal, fetch, headers: { authorization: `Bearer ${key('MINIMAX_API_KEY')}` },
      json: { model, prompt, aspect_ratio: aspect, n: 1, response_format: 'base64', prompt_optimizer: true }
    });
    if (data.base_resp && data.base_resp.status_code !== 0) throw new ProviderError(this.name, data.base_resp.status_msg || `code ${data.base_resp.status_code}`);
    const b64 = data.data?.image_base64?.[0];
    if (b64) return { buffer: Buffer.from(b64, 'base64'), mime: 'image/jpeg' };
    const url = data.data?.image_urls?.[0];
    if (!url) throw new ProviderError(this.name, 'no image in response');
    return { url };
  }
};

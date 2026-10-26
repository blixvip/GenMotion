import { request, SIZES, ProviderError } from '../util.mjs';

// Zhipu AI. International accounts (z.ai) set ZHIPU_BASE_URL=https://api.z.ai/api/paas/v4.
export default {
  id: 'cogview', name: 'CogView-4', maker: 'Zhipu AI', region: 'china',
  keys: ['ZHIPU_API_KEY'], signup: 'https://open.bigmodel.cn/usercenter/apikeys',
  models: ['cogview-4-250304', 'cogview-4'], defaultModel: 'cogview-4-250304',
  strengths: 'Strong Chinese-language prompts and in-image Chinese text.',
  async generate({ prompt, aspect, model }, { key, signal, fetch }) {
    const base = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    const [w, h] = SIZES.multiple16[aspect];
    const data = await request(this.name, `${base}/images/generations`, {
      method: 'POST', signal, fetch, headers: { authorization: `Bearer ${key('ZHIPU_API_KEY')}` },
      json: { model, prompt, size: `${w}x${h}`, quality: 'hd' }
    });
    const url = data.data?.[0]?.url;
    if (!url) throw new ProviderError(this.name, 'no image in response');
    return { url };
  }
};

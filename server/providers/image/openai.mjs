import { request, SIZES, dataUrlToImage, ProviderError } from '../util.mjs';

export default {
  id: 'openai', name: 'OpenAI GPT Image', maker: 'OpenAI', region: 'global',
  keys: ['OPENAI_API_KEY'], signup: 'https://platform.openai.com/api-keys',
  models: ['gpt-image-1', 'gpt-image-1-mini'], defaultModel: 'gpt-image-1',
  strengths: 'Best at following long prompts and rendering readable text.',
  async generate({ prompt, aspect, model }, { key, signal, fetch }) {
    const data = await request(this.name, `${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/images/generations`, {
      method: 'POST', signal, fetch, headers: { authorization: `Bearer ${key('OPENAI_API_KEY')}` },
      json: { model, prompt, size: SIZES.openai[aspect], quality: 'high', n: 1 }
    });
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError(this.name, 'no image in response');
    return dataUrlToImage(b64);
  }
};

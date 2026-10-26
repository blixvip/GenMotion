import { request, poll, SIZES, ProviderError } from '../util.mjs';

// Alibaba Model Studio (DashScope) async text-to-image: submit a task, poll it. Qwen-Image and
// Wan share this endpoint. International by default; set DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com
// for a mainland China account.
async function dashscope(adapter, { prompt, aspect, model, negative, seed }, { key, signal, fetch }, sizes) {
  const base = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com';
  const headers = { authorization: `Bearer ${key('DASHSCOPE_API_KEY')}` };
  const parameters = { size: sizes[aspect], n: 1, prompt_extend: true, watermark: false };
  if (seed != null) parameters.seed = seed;
  const input = { prompt };
  if (negative) input.negative_prompt = negative;
  const job = await request(adapter.name, `${base}/api/v1/services/aigc/text2image/image-synthesis`, {
    method: 'POST', signal, fetch, headers: { ...headers, 'X-DashScope-Async': 'enable' }, json: { model, input, parameters }
  });
  const id = job.output?.task_id;
  if (!id) throw new ProviderError(adapter.name, 'no task id returned');
  return poll(adapter.name, async () => {
    const r = await request(adapter.name, `${base}/api/v1/tasks/${id}`, { signal, fetch, headers });
    const status = r.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = r.output.results?.find(x => x.url)?.url;
      if (!url) throw new ProviderError(adapter.name, r.output.results?.[0]?.message || 'task finished without an image');
      return { url };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') throw new ProviderError(adapter.name, r.output?.message || status);
  }, { signal, interval: 2000 });
}

export const qwen = {
  id: 'qwen', name: 'Qwen-Image', maker: 'Alibaba', region: 'china',
  keys: ['DASHSCOPE_API_KEY'], signup: 'https://modelstudio.console.alibabacloud.com/',
  models: ['qwen-image-plus', 'qwen-image'], defaultModel: 'qwen-image-plus',
  strengths: 'Best-in-class text rendering in images, English and Chinese.',
  generate(params, ctx) { return dashscope(this, params, ctx, SIZES.dashscope); }
};

export const wan = {
  id: 'wan', name: 'Wan 2.2', maker: 'Alibaba', region: 'china',
  keys: ['DASHSCOPE_API_KEY'], signup: 'https://modelstudio.console.alibabacloud.com/',
  models: ['wan2.2-t2i-plus', 'wan2.2-t2i-flash'], defaultModel: 'wan2.2-t2i-plus',
  strengths: 'Cinematic stills with film-like lighting; pairs with Wan video.',
  generate(params, ctx) { return dashscope(this, params, ctx, SIZES.wan); }
};

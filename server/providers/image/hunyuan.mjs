import { createHash, createHmac } from 'node:crypto';
import { request, poll, ProviderError } from '../util.mjs';

// Tencent Hunyuan Image through Tencent Cloud's API (TC3-HMAC-SHA256 signed). Needs a
// SecretId + SecretKey with the Hunyuan service enabled. Easier path: Hunyuan on fal.ai.
const HOST = 'hunyuan.tencentcloudapi.com';
const sha256 = s => createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();

export function tc3Headers({ secretId, secretKey, action, payload, region = 'ap-guangzhou', version = '2023-09-01', now = Math.floor(Date.now() / 1000) }) {
  const date = new Date(now * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify(payload);
  const canonical = ['POST', '/', '', `content-type:application/json; charset=utf-8\nhost:${HOST}\n`, 'content-type;host', sha256(body)].join('\n');
  const scope = `${date}/hunyuan/tc3_request`;
  const toSign = ['TC3-HMAC-SHA256', now, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(`TC3${secretKey}`, date), 'hunyuan'), 'tc3_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    body,
    headers: {
      authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
      'content-type': 'application/json; charset=utf-8', host: HOST,
      'x-tc-action': action, 'x-tc-timestamp': String(now), 'x-tc-version': version, 'x-tc-region': region
    }
  };
}

const RES = { '16:9': '1280:720', '9:16': '720:1280', '1:1': '1024:1024' };

export default {
  id: 'hunyuan', name: 'Hunyuan Image', maker: 'Tencent', region: 'china',
  keys: ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'], signup: 'https://console.cloud.tencent.com/cam/capi',
  models: ['hunyuan-image'], defaultModel: 'hunyuan-image',
  strengths: 'Tencent flagship; vivid Asian aesthetics and detailed scenes.',
  async generate({ prompt, aspect, negative, seed }, { key, signal, fetch }) {
    const call = async (action, payload) => {
      const { body, headers } = tc3Headers({ secretId: key('TENCENT_SECRET_ID'), secretKey: key('TENCENT_SECRET_KEY'), action, payload, region: process.env.TENCENT_REGION || 'ap-guangzhou' });
      const r = await request(this.name, `https://${HOST}/`, { method: 'POST', signal, fetch, headers, body });
      if (r.Response?.Error) throw new ProviderError(this.name, `${r.Response.Error.Code}: ${r.Response.Error.Message}`);
      return r.Response;
    };
    const payload = { Prompt: prompt, Resolution: RES[aspect], LogoAdd: 0, Revise: 1 };
    if (negative) payload.NegativePrompt = negative;
    if (seed != null) payload.Seed = seed;
    const { JobId } = await call('SubmitHunyuanImageJob', payload);
    return poll(this.name, async () => {
      const r = await call('QueryHunyuanImageJob', { JobId });
      if (r.JobStatusCode === '5') return { url: r.ResultImage?.[0] };
      if (r.JobStatusCode === '4') throw new ProviderError(this.name, r.JobErrorMsg || 'failed');
    }, { signal, interval: 2500 });
  }
};

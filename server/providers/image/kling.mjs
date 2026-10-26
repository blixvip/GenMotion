import { createHmac } from 'node:crypto';
import { request, poll, ProviderError } from '../util.mjs';

const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// Kling signs every call with a short-lived HS256 JWT built from the access key + secret key.
export function klingToken(accessKey, secretKey, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const sig = b64url(createHmac('sha256', secretKey).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export default {
  id: 'kling', name: 'Kling Image', maker: 'Kuaishou', region: 'china',
  keys: ['KLING_ACCESS_KEY', 'KLING_SECRET_KEY'], signup: 'https://app.klingai.com/global/dev',
  models: ['kling-v2', 'kling-v2-new', 'kling-v1-5'], defaultModel: 'kling-v2',
  strengths: 'Rich, cinematic frames; same account unlocks Kling video.',
  async generate({ prompt, aspect, model, negative }, { key, signal, fetch }) {
    const base = process.env.KLING_BASE_URL || 'https://api-singapore.klingai.com';
    const auth = () => ({ authorization: `Bearer ${klingToken(key('KLING_ACCESS_KEY'), key('KLING_SECRET_KEY'))}` });
    const json = { model_name: model, prompt, aspect_ratio: aspect, n: 1 };
    if (negative) json.negative_prompt = negative;
    const job = await request(this.name, `${base}/v1/images/generations`, { method: 'POST', signal, fetch, headers: auth(), json });
    if (job.code && job.code !== 0) throw new ProviderError(this.name, job.message || `code ${job.code}`);
    const id = job.data?.task_id;
    if (!id) throw new ProviderError(this.name, 'no task id returned');
    return poll(this.name, async () => {
      const r = await request(this.name, `${base}/v1/images/generations/${id}`, { signal, fetch, headers: auth() });
      const status = r.data?.task_status;
      if (status === 'succeed') {
        const url = r.data.task_result?.images?.[0]?.url;
        if (!url) throw new ProviderError(this.name, 'task finished without an image');
        return { url };
      }
      if (status === 'failed') throw new ProviderError(this.name, r.data?.task_status_msg || 'failed');
    }, { signal, interval: 2500 });
  }
};

// Every image adapter is exercised against a scripted fake of its API: the request it sends
// (URL, auth header, body) and how it reads the reply, including async task polling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_PROVIDERS, imageProvider } from '../server/providers/index.mjs';
import { klingToken } from '../server/providers/image/kling.mjs';
import { tc3Headers } from '../server/providers/image/hunyuan.mjs';
import { createHmac } from 'node:crypto';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const B64 = PNG.toString('base64');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Replies are matched in order; each one can assert on the request it answers.
function fake(replies) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body };
    calls.push(call);
    const next = replies[calls.length - 1];
    if (!next) throw new Error(`unexpected call ${call.method} ${call.url}`);
    return next(call);
  };
  return { fetch, calls };
}
const key = name => `test-${name}`;
const run = (id, replies, params = {}) => {
  const f = fake(replies);
  const p = imageProvider(id);
  return p.generate({ prompt: 'a lighthouse at dawn', aspect: '16:9', model: p.defaultModel, ...params }, { key, fetch: f.fetch }).then(r => ({ r, calls: f.calls }));
};
const body = c => (typeof c.body === 'string' ? JSON.parse(c.body) : c.body);

test('registry: every provider is complete and ids are unique', () => {
  const ids = new Set();
  for (const p of IMAGE_PROVIDERS) {
    assert.ok(p.id && p.name && p.maker && p.keys.length && p.models.length && p.defaultModel && typeof p.generate === 'function', p.id);
    assert.ok(['global', 'china'].includes(p.region), p.id);
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`); ids.add(p.id);
  }
  const china = IMAGE_PROVIDERS.filter(p => p.region === 'china').map(p => p.id).sort();
  assert.deepEqual(china, ['cogview', 'hunyuan', 'kling', 'minimax', 'qwen', 'seedream', 'wan']);
});

test('openai', async () => {
  const { r, calls } = await run('openai', [c => { assert.equal(c.headers.authorization, 'Bearer test-OPENAI_API_KEY'); assert.equal(body(c).size, '1536x1024'); return json({ data: [{ b64_json: B64 }] }); }]);
  assert.match(calls[0].url, /\/v1\/images\/generations$/);
  assert.deepEqual(r.buffer, PNG);
});

test('gemini image', async () => {
  const { r } = await run('gemini', [c => {
    assert.equal(c.headers['x-goog-api-key'], 'test-GEMINI_API_KEY');
    assert.equal(body(c).generationConfig.imageConfig.aspectRatio, '16:9');
    return json({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: B64 } }] } }] });
  }]);
  assert.equal(r.mime, 'image/png');
});

test('gemini image reports a block reason', async () => {
  await assert.rejects(run('gemini', [() => json({ promptFeedback: { blockReason: 'SAFETY' } })]), /SAFETY/);
});

test('imagen', async () => {
  const { r, calls } = await run('imagen', [() => json({ predictions: [{ bytesBase64Encoded: B64, mimeType: 'image/png' }] })]);
  assert.match(calls[0].url, /imagen-4\.0-generate-001:predict$/);
  assert.deepEqual(r.buffer, PNG);
});

test('flux polls until ready', async () => {
  const { r, calls } = await run('flux', [
    c => { assert.equal(c.headers['x-key'], 'test-BFL_API_KEY'); assert.equal(body(c).width, 1440); return json({ id: 'job1', polling_url: 'https://api.bfl.ai/v1/get_result?id=job1' }); },
    () => json({ status: 'Pending' }),
    () => json({ status: 'Ready', result: { sample: 'https://cdn/x.png' } })
  ]);
  assert.equal(r.url, 'https://cdn/x.png');
  assert.equal(calls.length, 3);
});

test('flux surfaces moderation', async () => {
  await assert.rejects(run('flux', [() => json({ id: 'j', polling_url: 'https://p' }), () => json({ status: 'Content Moderated' })]), /Moderated/);
});

test('ideogram sends multipart', async () => {
  const { r } = await run('ideogram', [c => { assert.ok(c.body instanceof FormData); assert.equal(c.body.get('aspect_ratio'), '16x9'); assert.equal(c.headers['api-key'], 'test-IDEOGRAM_API_KEY'); return json({ data: [{ url: 'https://i/1.png' }] }); }]);
  assert.equal(r.url, 'https://i/1.png');
});

test('recraft', async () => {
  const { r } = await run('recraft', [c => { assert.equal(body(c).size, '1820x1024'); return json({ data: [{ url: 'https://r/1.png' }] }); }]);
  assert.equal(r.url, 'https://r/1.png');
});

test('stability returns raw bytes', async () => {
  const { r, calls } = await run('stability', [() => new Response(PNG, { headers: { 'content-type': 'image/png' } })]);
  assert.match(calls[0].url, /generate\/ultra$/);
  assert.deepEqual(r.buffer, PNG);
});

test('xai', async () => {
  const { r } = await run('xai', [c => { assert.equal(body(c).response_format, 'b64_json'); return json({ data: [{ b64_json: B64 }] }); }]);
  assert.deepEqual(r.buffer, PNG);
});

test('seedream (BytePlus Ark)', async () => {
  const { r, calls } = await run('seedream', [c => { assert.equal(body(c).size, '2560x1440'); assert.equal(body(c).watermark, false); return json({ data: [{ url: 'https://ark/1.png' }] }); }]);
  assert.match(calls[0].url, /bytepluses\.com\/api\/v3\/images\/generations$/);
  assert.equal(r.url, 'https://ark/1.png');
});

test('qwen-image submits an async task and polls it', async () => {
  const { r, calls } = await run('qwen', [
    c => { assert.equal(c.headers['x-dashscope-async'], 'enable'); assert.equal(body(c).parameters.size, '1664*928'); return json({ output: { task_id: 't1', task_status: 'PENDING' } }); },
    () => json({ output: { task_status: 'RUNNING' } }),
    () => json({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/q.png' }] } })
  ]);
  assert.match(calls[1].url, /\/api\/v1\/tasks\/t1$/);
  assert.equal(r.url, 'https://oss/q.png');
});

test('wan uses wan sizes', async () => {
  const { r } = await run('wan', [c => { assert.equal(body(c).parameters.size, '1440*810'); return json({ output: { task_id: 't2' } }); }, () => json({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss/w.png' }] } })]);
  assert.equal(r.url, 'https://oss/w.png');
});

test('dashscope failure message is kept', async () => {
  await assert.rejects(run('qwen', [() => json({ output: { task_id: 't3' } }), () => json({ output: { task_status: 'FAILED', message: 'DataInspectionFailed' } })]), /DataInspectionFailed/);
});

test('kling signs a valid HS256 JWT', () => {
  const tok = klingToken('ak', 'sk', 1_700_000_000);
  const [h, b, s] = tok.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url')), { iss: 'ak', exp: 1_700_001_800, nbf: 1_699_999_995 });
  assert.equal(s, createHmac('sha256', 'sk').update(`${h}.${b}`).digest('base64url'));
});

test('kling task flow', async () => {
  const { r, calls } = await run('kling', [
    c => { assert.match(c.headers.authorization, /^Bearer ey/); assert.equal(body(c).aspect_ratio, '16:9'); return json({ code: 0, data: { task_id: 'k1' } }); },
    () => json({ code: 0, data: { task_status: 'processing' } }),
    () => json({ code: 0, data: { task_status: 'succeed', task_result: { images: [{ url: 'https://k/1.png' }] } } })
  ]);
  assert.match(calls[2].url, /\/v1\/images\/generations\/k1$/);
  assert.equal(r.url, 'https://k/1.png');
});

test('cogview', async () => {
  const { r } = await run('cogview', [c => { assert.equal(body(c).size, '1728x960'); return json({ data: [{ url: 'https://z/1.png' }] }); }]);
  assert.equal(r.url, 'https://z/1.png');
});

test('minimax base64 + base_resp errors', async () => {
  const { r } = await run('minimax', [() => json({ data: { image_base64: [B64] }, base_resp: { status_code: 0 } })]);
  assert.deepEqual(r.buffer, PNG);
  await assert.rejects(run('minimax', [() => json({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } })]), /insufficient balance/);
});

test('hunyuan TC3 signature is deterministic and the job is polled', async () => {
  const a = tc3Headers({ secretId: 'id', secretKey: 'key', action: 'SubmitHunyuanImageJob', payload: { Prompt: 'x' }, now: 1_700_000_000 });
  const b = tc3Headers({ secretId: 'id', secretKey: 'key', action: 'SubmitHunyuanImageJob', payload: { Prompt: 'x' }, now: 1_700_000_000 });
  assert.equal(a.headers.authorization, b.headers.authorization);
  assert.match(a.headers.authorization, /^TC3-HMAC-SHA256 Credential=id\/2023-11-14\/hunyuan\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/);
  const { r, calls } = await run('hunyuan', [
    c => { assert.equal(c.headers['x-tc-action'], 'SubmitHunyuanImageJob'); assert.equal(JSON.parse(c.body).Resolution, '1280:720'); return json({ Response: { JobId: 'h1' } }); },
    c => { assert.equal(c.headers['x-tc-action'], 'QueryHunyuanImageJob'); return json({ Response: { JobStatusCode: '5', ResultImage: ['https://t/1.png'] } }); }
  ]);
  assert.equal(calls.length, 2);
  assert.equal(r.url, 'https://t/1.png');
});

test('fal takes any model id', async () => {
  const { r, calls } = await run('fal', [c => { assert.equal(c.headers.authorization, 'Key test-FAL_KEY'); return json({ images: [{ url: 'https://fal/1.png' }] }); }], { model: 'fal-ai/qwen-image' });
  assert.equal(calls[0].url, 'https://fal.run/fal-ai/qwen-image');
  assert.equal(r.url, 'https://fal/1.png');
});

test('replicate waits then polls', async () => {
  const { r } = await run('replicate', [
    c => { assert.equal(c.headers.prefer, 'wait=60'); return json({ id: 'p1', status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } }); },
    () => json({ status: 'succeeded', output: ['https://rep/1.png'] })
  ]);
  assert.equal(r.url, 'https://rep/1.png');
});

test('HTTP errors become readable messages', async () => {
  await assert.rejects(run('openai', [() => json({ error: { message: 'Incorrect API key provided' } }, 401)]), /HTTP 401 Incorrect API key provided — check the API key/);
  await assert.rejects(run('seedream', [() => json({ error: { code: 'RateLimit', message: 'slow down' } }, 429)]), /rate limited/);
});

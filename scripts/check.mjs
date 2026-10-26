// End-to-end server check: starts GenMotion on a spare port with a throwaway library and
// .env, then drives the HTTP API the way the studio does. No API keys or network needed.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'genmotion-check-'));
const port = 4600 + Math.floor(Math.random() * 300);
const envFile = join(tmp, '.env');
writeFileSync(envFile, '');
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_API_TOKEN$|^FAL_KEY$|^KLING_|^TENCENT_SECRET/.test(k)));
const server = spawn(process.execPath, [join(root, 'server/index.mjs')], {
  env: { ...clean, PORT: String(port), GENMOTION_LIBRARY: join(tmp, 'library'), GENMOTION_ENV_FILE: envFile },
  stdio: ['ignore', 'pipe', 'inherit']
});
const base = `http://127.0.0.1:${port}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const call = async (path, init = {}) => {
  const res = await fetch(base + path, init);
  const text = await res.text();
  let body = text; try { body = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, body };
};
const steps = [];
const step = async (name, fn) => { await fn(); steps.push(name); console.log(`  ✓ ${name}`); };

try {
  await waitUp();
  await step('studio page and engine modules are served', async () => {
    for (const p of ['/', '/app.mjs', '/app.css', '/engine/render.mjs', '/engine/storyboard.mjs', '/vendor/mp4-muxer.js']) assert.equal((await call(p)).status, 200, p);
  });
  await step('path traversal is blocked', async () => {
    assert.notEqual((await call('/..%2fpackage.json')).status, 200);
    assert.notEqual((await call('/library/..%2f..%2fpackage.json')).status, 200);
  });
  await step('provider catalog lists 17 image models, nothing ready without keys', async () => {
    const { body } = await call('/api/providers');
    assert.equal(body.image.length, 17);
    assert.ok(body.image.every(p => !p.ready));
    assert.ok(body.keys.every(k => !k.set && !('value' in k)));
  });
  await step('generate without a key explains what to add', async () => {
    const { status, body } = await call('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'seedream', prompt: 'x' }) });
    assert.equal(status, 400); assert.match(body.error, /ARK_API_KEY/);
  });
  await step('cross-site requests are refused', async () => {
    const r = await call('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ name: 'OPENAI_API_KEY', value: 'x' }) });
    assert.equal(r.status, 403);
    // fetch() cannot spoof Host, so use a raw request (DNS-rebinding style).
    const status = await new Promise((resolve, reject) => httpRequest({ host: '127.0.0.1', port, path: '/api/providers', headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end());
    assert.equal(status, 403);
  });
  await step('saving a key marks providers ready, masks the key, and clearing it undoes that', async () => {
    let { body } = await call('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ name: 'DASHSCOPE_API_KEY', value: 'sk-check-1234' }) });
    assert.ok(body.image.find(p => p.id === 'qwen').ready && body.image.find(p => p.id === 'wan').ready);
    assert.ok(body.director.find(p => p.id === 'qwen').ready);
    assert.equal(body.keys.find(k => k.name === 'DASHSCOPE_API_KEY').hint, '••••1234');
    assert.ok(!JSON.stringify(body).includes('sk-check-1234'));
    ({ body } = await call('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'DASHSCOPE_API_KEY', value: '' }) }));
    assert.ok(!body.image.find(p => p.id === 'qwen').ready);
    const bad = await call('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'PATH', value: 'x' }) });
    assert.equal(bad.status, 400);
  });
  await step('offline director writes a storyboard', async () => {
    const { status, body } = await call('/api/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'A film for Nova. Night city. Then the logo.', aspect: '9:16' }) });
    assert.equal(status, 200); assert.equal(body.director, 'offline'); assert.equal(body.storyboard.aspect, '9:16');
  });
  let src;
  await step('image upload lands in the library and is served', async () => {
    const { body } = await call('/api/upload', { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'dot.png' }, body: PNG });
    src = body.src; assert.match(src, /^\/library\/images\/.+\.png$/);
    const img = await fetch(base + src); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    const lib = await call('/api/library'); assert.equal(lib.body[0].src, src);
  });
  await step('non-images are rejected', async () => {
    const r = await call('/api/upload', { method: 'POST', headers: { 'content-type': 'text/html' }, body: '<script>1</script>' });
    assert.equal(r.status, 415); assert.match(r.body.error, /not an image/);
  });
  await step('projects save and load', async () => {
    const sb = { title: 'Check', scenes: [{ name: 'One', image: { src } }] };
    assert.equal((await call('/api/projects/check1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storyboard: sb }) })).status, 200);
    const back = await call('/api/projects/check1'); assert.equal(back.body.storyboard.title, 'Check');
    const list = await call('/api/projects'); assert.equal(list.body[0].poster, src);
  });
  await step('library delete', async () => {
    const id = src.split('/').pop().replace(/\.png$/, '');
    assert.equal((await call(`/api/library/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call('/api/library')).body.length, 0);
  });
  console.log(`\n  ${steps.length} checks passed`);
} catch (err) {
  console.error(`\n  ✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}

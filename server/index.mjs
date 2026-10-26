#!/usr/bin/env node
// GenMotion local server: serves the studio, keeps API keys server-side, proxies image and
// director calls to whichever providers you have keys for, and stores results in ./library.
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, loadEnv, saveKey, env } from './env.mjs';
import { IMAGE_PROVIDERS, imageProvider, ready, keyCatalog, describe } from './providers/index.mjs';
import { LLMS, directorModel } from './providers/llm/index.mjs';
import { ProviderError } from './providers/util.mjs';
import { direct } from './director.mjs';
import { LIBRARY, saveImage, listImages, deleteImage, saveProject, loadProject, listProjects } from './library.mjs';
import { ASPECTS } from '../web/engine/storyboard.mjs';

loadEnv();
const PORT = Number(process.env.PORT || process.env.GENMOTION_PORT || 4520);
const HOST = process.env.GENMOTION_HOST || '127.0.0.1';
const WEB = join(ROOT, 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8'
};
const AUDIO = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg' };

const send = (res, status, body, headers = {}) => {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isJson ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
};

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error(`Upload too large (max ${Math.round(limit / 1e6)} MB)`), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const readJson = async req => { const b = await readBody(req, 4e6); return b.length ? JSON.parse(b.toString('utf8')) : {}; };

// Only this machine may talk to the server, and only pages it served may change things.
function trusted(req) {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  const local = ['127.0.0.1', 'localhost', '[::1]'];
  if (HOST === '127.0.0.1' && !local.includes(host)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // curl / scripts on this machine
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function serveFile(res, root, rel, cache = 'no-cache') {
  const base = resolve(root);
  let file;
  try { file = resolve(base, decodeURIComponent(rel)); } catch { return send(res, 400, 'Bad path'); }
  if (!file.startsWith(base + sep) && file !== base) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (!info.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': info.size, 'cache-control': cache });
    res.end(await readFile(file));
  } catch { send(res, 404, 'Not found'); }
}

function providersPayload() {
  return {
    image: IMAGE_PROVIDERS.map(describe),
    director: LLMS.map(p => ({ id: p.id, name: p.name, maker: p.maker, region: p.region, keys: p.keys, models: p.models, defaultModel: directorModel(p), ready: ready(p) })),
    keys: keyCatalog(),
    preferredDirector: env('GENMOTION_DIRECTOR') || ''
  };
}

const routes = {
  'GET /api/providers': async () => providersPayload(),

  'POST /api/keys': async req => {
    const { name, value } = await readJson(req);
    const allowed = new Set([...keyCatalog().map(k => k.name), 'GENMOTION_DIRECTOR']);
    if (!allowed.has(name)) throw Object.assign(new Error(`Unknown key ${name}`), { status: 400 });
    saveKey(name, value);
    return providersPayload();
  },

  'POST /api/direct': async req => {
    const body = await readJson(req);
    if (body.aspect && !ASPECTS[body.aspect]) throw Object.assign(new Error('Bad aspect'), { status: 400 });
    return direct({ ...body, signal: abortOnClose(req) });
  },

  'POST /api/generate': async req => {
    const { provider: id, model, prompt, aspect = '16:9', negative, seed } = await readJson(req);
    const p = imageProvider(id);
    if (!p) throw Object.assign(new Error(`Unknown image model ${id}`), { status: 400 });
    if (!ready(p)) throw Object.assign(new Error(`${p.name} needs ${p.keys.join(' + ')} — add it in Settings`), { status: 400 });
    if (!String(prompt || '').trim()) throw Object.assign(new Error('Empty prompt'), { status: 400 });
    if (!ASPECTS[aspect]) throw Object.assign(new Error('Bad aspect'), { status: 400 });
    const useModel = (p.freeModel ? model : p.models.includes(model) ? model : '') || p.defaultModel;
    const started = Date.now(), signal = abortOnClose(req);
    const result = await p.generate({ prompt: String(prompt).slice(0, 4000), aspect, model: useModel, negative, seed: seed ?? undefined }, { key: env, signal, fetch: globalThis.fetch });
    return saveImage(result, { provider: p.id, providerName: p.name, model: useModel, prompt, aspect, ms: Date.now() - started }, { signal });
  },

  'POST /api/upload': async req => {
    const mime = (req.headers['content-type'] || '').split(';')[0];
    const buf = await readBody(req, 40e6);
    if (AUDIO[mime]) {
      const dir = join(LIBRARY, 'audio'); await mkdir(dir, { recursive: true });
      const file = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.${AUDIO[mime]}`;
      await writeFile(join(dir, file), buf);
      return { src: `/library/audio/${file}`, name: decodeURIComponent(req.headers['x-file-name'] || file) };
    }
    return saveImage({ buffer: buf, mime }, { provider: 'upload', providerName: 'Upload', prompt: decodeURIComponent(req.headers['x-file-name'] || 'uploaded image') });
  },

  'GET /api/library': async () => listImages(),
  'GET /api/projects': async () => listProjects()
};

function abortOnClose(req) {
  const ctl = new AbortController();
  req.on('close', () => { if (!req.complete || req.socket.destroyed) ctl.abort(new Error('client left')); });
  return ctl.signal;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (!trusted(req)) return send(res, 403, 'GenMotion only answers to this machine');
    const key = `${req.method} ${url.pathname}`;
    if (routes[key]) return send(res, 200, await routes[key](req, res));
    let m;
    if ((m = url.pathname.match(/^\/api\/library\/([a-z0-9-]+)$/)) && req.method === 'DELETE') { await deleteImage(m[1]); return send(res, 200, { ok: true }); }
    if ((m = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)$/))) {
      if (req.method === 'PUT') { await saveProject(m[1], (await readJson(req)).storyboard); return send(res, 200, { ok: true }); }
      if (req.method === 'GET') return send(res, 200, await loadProject(m[1]));
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'No such endpoint' });
    if (url.pathname.startsWith('/library/')) return serveFile(res, LIBRARY, url.pathname.slice('/library/'.length), 'public, max-age=31536000, immutable');
    return serveFile(res, WEB, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (err) {
    const status = err.status || (err instanceof ProviderError ? 502 : err instanceof SyntaxError ? 400 : 500);
    if (status >= 500 && !(err instanceof ProviderError)) console.error(err);
    if (!res.headersSent) send(res, status, { error: err.message, retryable: !!err.retryable });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`;
  const imgs = IMAGE_PROVIDERS.filter(ready).map(p => p.name);
  const dirs = LLMS.filter(ready).map(p => p.name);
  console.log(`\n  GenMotion  ${url}\n`);
  console.log(`  image models  ${imgs.length ? imgs.join(', ') : 'none yet — add a key in Settings'}`);
  console.log(`  director      ${dirs.length ? dirs.join(', ') : 'offline planner — add any text-model key for a real director'}\n`);
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  }
});

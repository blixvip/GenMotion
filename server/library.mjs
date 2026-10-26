// Every generated or uploaded image is kept on disk under library/images with a small JSON
// sidecar (prompt, model, time). Provider URLs expire, so images are always downloaded.
import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT } from './env.mjs';
import { request } from './providers/util.mjs';

export const LIBRARY = process.env.GENMOTION_LIBRARY || join(ROOT, 'library');
const IMAGES = join(LIBRARY, 'images');
const PROJECTS = join(LIBRARY, 'projects');
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return '';
}

export async function saveImage(result, meta, { fetch = globalThis.fetch, signal } = {}) {
  let { buffer, mime } = result;
  if (!buffer && result.url) {
    const res = await request(meta.providerName || 'download', result.url, { raw: true, fetch, signal, timeout: 120_000 });
    buffer = Buffer.from(await res.arrayBuffer());
    mime = res.headers.get('content-type')?.split(';')[0];
  }
  if (!buffer?.length) throw new Error('Provider returned an empty image');
  mime = sniff(buffer) || mime;
  const ext = EXT[mime];
  if (!ext) throw Object.assign(new Error(`Got ${mime || 'an unknown file type'}, not an image`), { status: 415 });
  await mkdir(IMAGES, { recursive: true });
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const file = `${id}.${ext}`;
  const entry = { id, file, src: `/library/images/${file}`, bytes: buffer.length, created: new Date().toISOString(), ...meta };
  await writeFile(join(IMAGES, file), buffer);
  await writeFile(join(IMAGES, `${id}.json`), JSON.stringify(entry, null, 2));
  return entry;
}

export async function listImages() {
  await mkdir(IMAGES, { recursive: true });
  const files = (await readdir(IMAGES)).filter(f => f.endsWith('.json'));
  const rows = await Promise.all(files.map(async f => { try { return JSON.parse(await readFile(join(IMAGES, f), 'utf8')); } catch { return null; } }));
  return rows.filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
}

export async function deleteImage(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Bad id');
  const entry = JSON.parse(await readFile(join(IMAGES, `${id}.json`), 'utf8'));
  await unlink(join(IMAGES, entry.file)).catch(() => {});
  await unlink(join(IMAGES, `${id}.json`));
}

const projectFile = id => {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('Bad project id');
  return join(PROJECTS, `${id}.json`);
};

export async function saveProject(id, storyboard) {
  await mkdir(PROJECTS, { recursive: true });
  await writeFile(projectFile(id), JSON.stringify({ id, saved: new Date().toISOString(), storyboard }, null, 2));
}

export async function loadProject(id) {
  return JSON.parse(await readFile(projectFile(id), 'utf8'));
}

export async function listProjects() {
  await mkdir(PROJECTS, { recursive: true });
  const files = (await readdir(PROJECTS)).filter(f => f.endsWith('.json'));
  const rows = await Promise.all(files.map(async f => {
    try { const p = JSON.parse(await readFile(join(PROJECTS, f), 'utf8')); return { id: p.id, saved: p.saved, title: p.storyboard?.title, scenes: p.storyboard?.scenes?.length || 0, poster: p.storyboard?.scenes?.find(s => s.image?.src)?.image.src || '' }; } catch { return null; }
  }));
  return rows.filter(Boolean).sort((a, b) => b.saved.localeCompare(a.saved));
}

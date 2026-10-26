// Keys live in a plain .env file next to package.json. The server reads it at start and the
// Settings panel writes to it, so a key pasted in the browser survives restarts. Keys never
// leave the server: the browser only ever sees "set" / "not set" and the last four characters.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.GENMOTION_ENV_FILE || join(ROOT, '.env');

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/;

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(LINE);
    if (!m) continue;
    let value = (m[2] || '').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.startsWith('#') ? '' : value.replace(/\s+#.*$/, '');
    out[m[1]] = value;
  }
  return out;
}

// Real environment variables win over the file, so CI and shells can override.
export function loadEnv() {
  const file = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
  for (const [k, v] of Object.entries(file)) if (process.env[k] === undefined) process.env[k] = v;
  return file;
}

export function env(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : '';
}

// Rewrites one key in place (or appends it). An empty value removes the key.
export function saveKey(name, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Bad key name: ${name}`);
  const clean = String(value ?? '').replace(/[\r\n]/g, '').trim();
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  const at = lines.findIndex(l => (l.match(LINE) || [])[1] === name);
  if (clean) {
    const row = `${name}=${clean}`;
    if (at >= 0) lines[at] = row; else lines.push(row);
    process.env[name] = clean;
  } else {
    if (at >= 0) lines.splice(at, 1);
    delete process.env[name];
  }
  writeFileSync(ENV_FILE, lines.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n') + '\n');
}

export function mask(value) {
  return value ? `••••${value.slice(-4)}` : '';
}

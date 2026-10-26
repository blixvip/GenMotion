// Shared plumbing for provider adapters: HTTP with timeouts and readable errors, task polling,
// and the aspect-ratio → pixel-size tables each API wants in its own format.

export class ProviderError extends Error {
  constructor(provider, message, { status, retryable = false } = {}) {
    super(`${provider}: ${message}`);
    this.provider = provider; this.status = status; this.retryable = retryable;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('Aborted')); }, { once: true });
});

// Pulls the most useful message out of the many error shapes these APIs return.
export function errorText(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  const e = body.error ?? body.errors ?? body;
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map(x => x.message || x.detail || JSON.stringify(x)).join('; ');
  return e.message || e.msg || e.detail || body.message || body.base_resp?.status_msg || body.detail
    || (body.code && `${body.code}`) || JSON.stringify(body).slice(0, 300);
}

export async function request(provider, url, { method = 'GET', headers = {}, json, body, timeout = 120_000, signal, fetch = globalThis.fetch, raw = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timed out')), timeout);
  const onAbort = () => ctl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    res = await fetch(url, {
      method, signal: ctl.signal,
      headers: json !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: json !== undefined ? JSON.stringify(json) : body
    });
  } catch (err) {
    throw new ProviderError(provider, `network error (${err.message || err})`, { retryable: true });
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
  }
  if (raw && res.ok) return res;
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' — check the API key' : res.status === 429 ? ' — rate limited or out of credit' : '';
    throw new ProviderError(provider, `HTTP ${res.status} ${errorText(data)}${hint}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
  }
  return data;
}

// Calls check() until it returns a value. check() returns undefined while the job is running.
export async function poll(provider, check, { interval = 1500, timeout = 300_000, signal } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await check();
    if (value !== undefined) return value;
    await sleep(interval, signal);
  }
  throw new ProviderError(provider, `still running after ${Math.round(timeout / 1000)}s, gave up`, { retryable: true });
}

export const ASPECTS = ['16:9', '9:16', '1:1'];

// Width x height per aspect at roughly 1-2 megapixels, rounded to what each family accepts.
export const SIZES = {
  openai: { '16:9': '1536x1024', '9:16': '1024x1536', '1:1': '1024x1024' },
  multiple32: { '16:9': [1440, 816], '9:16': [816, 1440], '1:1': [1024, 1024] },
  multiple16: { '16:9': [1728, 960], '9:16': [960, 1728], '1:1': [1280, 1280] },
  dashscope: { '16:9': '1664*928', '9:16': '928*1664', '1:1': '1328*1328' },
  wan: { '16:9': '1440*810', '9:16': '810*1440', '1:1': '1024*1024' },
  seedream: { '16:9': '2560x1440', '9:16': '1440x2560', '1:1': '2048x2048' },
  recraft: { '16:9': '1820x1024', '9:16': '1024x1820', '1:1': '1024x1024' },
  falPreset: { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd' },
  ideogram: { '16:9': '16x9', '9:16': '9x16', '1:1': '1x1' }
};

export function dataUrlToImage(b64, mime = 'image/png') {
  return { buffer: Buffer.from(b64, 'base64'), mime };
}

export function firstUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstUrl(value[0]);
  return value.url || value.uri || '';
}

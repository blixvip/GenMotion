import { request, ProviderError } from '../util.mjs';

export default {
  id: 'imagen', name: 'Imagen 4', maker: 'Google', region: 'global',
  keys: ['GEMINI_API_KEY'], signup: 'https://aistudio.google.com/apikey',
  models: ['imagen-4.0-generate-001', 'imagen-4.0-ultra-generate-001', 'imagen-4.0-fast-generate-001'], defaultModel: 'imagen-4.0-generate-001',
  strengths: 'Photoreal detail and clean composition.',
  async generate({ prompt, aspect, model }, { key, signal, fetch }) {
    const data = await request(this.name, `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, {
      method: 'POST', signal, fetch, headers: { 'x-goog-api-key': key('GEMINI_API_KEY') },
      json: { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect } }
    });
    const p = data.predictions?.[0];
    if (!p?.bytesBase64Encoded) throw new ProviderError(this.name, 'no image in response (prompt may have been filtered)');
    return { buffer: Buffer.from(p.bytesBase64Encoded, 'base64'), mime: p.mimeType || 'image/png' };
  }
};

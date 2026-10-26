import { request, ProviderError } from '../util.mjs';

export default {
  id: 'gemini', name: 'Gemini Image (Nano Banana)', maker: 'Google', region: 'global',
  keys: ['GEMINI_API_KEY'], signup: 'https://aistudio.google.com/apikey',
  models: ['gemini-2.5-flash-image'], defaultModel: 'gemini-2.5-flash-image',
  strengths: 'Fast, cheap, strong scene consistency.',
  async generate({ prompt, aspect, model }, { key, signal, fetch }) {
    const data = await request(this.name, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal, fetch, headers: { 'x-goog-api-key': key('GEMINI_API_KEY') },
      json: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } }
      }
    });
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
    const inline = part?.inlineData || part?.inline_data;
    if (!inline) throw new ProviderError(this.name, data.promptFeedback?.blockReason ? `blocked (${data.promptFeedback.blockReason})` : 'no image in response');
    return { buffer: Buffer.from(inline.data, 'base64'), mime: inline.mimeType || inline.mime_type || 'image/png' };
  }
};

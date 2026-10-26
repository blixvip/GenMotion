import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, timeline, imagePrompt, LAYERS } from '../web/engine/storyboard.mjs';
import { parseRuns, formatNumber } from '../web/engine/layers.mjs';
import { parseJson, offlinePlan, systemPrompt, direct } from '../server/director.mjs';
import { parseEnv } from '../server/env.mjs';

test('normalize fills defaults and clamps junk', () => {
  const sb = normalize({ aspect: '4:3', fps: 13, style: { palette: { bg: 'red', accent: '#abc' }, grain: 9 }, scenes: [{ duration: 99, layers: [{ type: 'nope' }, { type: 'headline', start: -3, reveal: 'zzz', position: 'middle' }] }] });
  assert.equal(sb.aspect, '16:9');
  assert.equal(sb.fps, 30);
  assert.equal(sb.style.palette.bg, '#0b0b0d');
  assert.equal(sb.style.palette.accent, '#abc');
  assert.equal(sb.style.grain, 0.3);
  assert.equal(sb.scenes[0].duration, 20);
  assert.equal(sb.scenes[0].layers.length, 1);
  const h = sb.scenes[0].layers[0];
  assert.equal(h.start, 0); assert.equal(h.reveal, 'rise'); assert.equal(h.position, 'center'); assert.equal(h.text, 'Headline');
});

test('normalize rejects image sources from outside the library', () => {
  const sb = normalize({ scenes: [{ image: { src: 'https://evil/x.png', history: ['/library/images/a.png', 'javascript:1'] } }] });
  assert.equal(sb.scenes[0].image.src, '');
  assert.deepEqual(sb.scenes[0].image.history, ['/library/images/a.png']);
});

test('normalize is idempotent', () => {
  const once = normalize(offlinePlan({ prompt: 'A coffee brand. Morning ritual. Then the logo.' }));
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(once))), once);
});

test('timeline overlaps transitions', () => {
  const sb = normalize({ scenes: [{ duration: 4 }, { duration: 4, transition: { type: 'fade', duration: 1 } }, { duration: 2, transition: { type: 'cut' } }] });
  const { spans, duration } = timeline(sb);
  assert.deepEqual(spans.map(s => s.start), [0, 3, 7]);
  assert.equal(duration, 9);
});

test('every layer type has defaults that survive normalize', () => {
  for (const type of Object.keys(LAYERS)) {
    const sb = normalize({ scenes: [{ duration: 5, layers: [{ type }] }] });
    assert.equal(sb.scenes[0].layers[0]?.type, type);
  }
});

test('image prompt adds the shared look', () => {
  const sb = normalize({ style: { imageStyle: 'shot on 35mm' }, scenes: [{ image: { prompt: 'a red door' } }] });
  assert.equal(imagePrompt(sb, sb.scenes[0]), 'a red door. shot on 35mm. no text, no watermark, no logos');
});

test('accent runs', () => {
  assert.deepEqual(parseRuns('Make *it move* now'), [{ text: 'Make', accent: false }, { text: 'it', accent: true }, { text: 'move', accent: true }, { text: 'now', accent: false }]);
  assert.deepEqual(parseRuns('*one*'), [{ text: 'one', accent: true }]);
});

test('number formatting', () => {
  assert.equal(formatNumber(1234567.891, 2), '1,234,567.89');
  assert.equal(formatNumber(-42, 0), '-42');
});

test('director JSON parsing tolerates fences and chatter', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Sure! {"a":{"b":2}} hope that helps'), { a: { b: 2 } });
  assert.throws(() => parseJson('no json'), /did not return JSON/);
});

test('offline planner makes an editable, valid storyboard', () => {
  const sb = offlinePlan({ prompt: 'Launch film for Orbit. Space is quiet. Then three numbers. End on the logo.', aspect: '9:16', mode: 'motion' });
  assert.equal(sb.aspect, '9:16');
  assert.ok(sb.scenes.length >= 4);
  assert.ok(sb.scenes.every(s => s.background !== 'image' && !s.image.prompt));
  assert.equal(sb.scenes.at(-1).layers[0].type, 'logo');
});

test('system prompt documents every layer and the mode', () => {
  const p = systemPrompt({ mode: 'images' });
  for (const type of Object.keys(LAYERS)) assert.ok(p.includes(`- ${type}:`), type);
  assert.match(systemPrompt({ mode: 'motion' }), /MOTION-ONLY/);
});

test('direct() uses a configured LLM and normalizes its output', async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) delete process.env[k];
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  const fetch = async (url, init) => {
    assert.match(String(url), /api\.deepseek\.com\/chat\/completions$/);
    assert.equal(JSON.parse(init.body).response_format.type, 'json_object');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"T","scenes":[{"duration":3,"background":"image","image":{"prompt":"x"},"layers":[{"type":"headline","text":"Hi"}]}]}' } }] }));
  };
  const res = await direct({ prompt: 'test', aspect: '1:1', director: 'deepseek', fetch });
  assert.equal(res.storyboard.aspect, '1:1');
  assert.equal(res.storyboard.scenes[0].layers[0].text, 'Hi');
  assert.match(res.director, /DeepSeek/);
  if (saved === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved;
});

test('.env.example parses to all-empty keys', async () => {
  const { readFileSync } = await import('node:fs');
  const vars = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
  assert.ok(Object.keys(vars).length >= 20);
  for (const [k, v] of Object.entries(vars)) assert.equal(v, '', k);
});

test('.env parsing', () => {
  assert.deepEqual(parseEnv('A=1\n# c\nexport B="two words"\nC=x # note\nD=\'q#\'\n bad line'), { A: '1', B: 'two words', C: 'x', D: 'q#' });
});

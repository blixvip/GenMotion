// Frame-accurate MP4 export: every frame is drawn by the same renderer as the preview at its
// exact time, encoded with WebCodecs (H.264 + AAC) and muxed in the browser. Nothing is
// screen-recorded, so a slow machine makes a slower export, never a choppier one.
import { createRenderer } from './render.mjs';
import { timeline, size } from './storyboard.mjs';

const Muxer = () => globalThis.Mp4Muxer;

export function canExport() {
  return typeof VideoEncoder === 'function' && typeof VideoFrame === 'function' && !!Muxer();
}

async function pickCodec(width, height, fps, bitrate) {
  for (const codec of ['avc1.640033', 'avc1.640032', 'avc1.4d0033', 'avc1.42003e']) {
    const config = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
    const { supported } = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (supported) return config;
  }
  throw new Error('This browser cannot encode H.264. Use Chrome or Edge.');
}

// Mixes the music track to the exact video length with short fades, as planar float32.
async function renderMusic(sb, duration, sampleRate = 48000) {
  if (!sb.music?.src) return null;
  const bytes = await (await fetch(sb.music.src)).arrayBuffer();
  const decoded = await new OfflineAudioContext(2, sampleRate, sampleRate).decodeAudioData(bytes);
  const off = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const src = off.createBufferSource(); src.buffer = decoded;
  const gain = off.createGain();
  const v = sb.music.volume;
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(v, Math.min(0.4, duration / 4));
  gain.gain.setValueAtTime(v, Math.max(0, duration - 1.2));
  gain.gain.linearRampToValueAtTime(0, duration);
  src.connect(gain).connect(off.destination); src.start(0);
  return off.startRendering();
}

export async function exportMp4(sb, { image, onProgress = () => {}, signal, bitrate } = {}) {
  if (!canExport()) throw new Error('Export needs Chrome or Edge (WebCodecs).');
  const { width, height } = size(sb);
  const fps = sb.fps, { duration } = timeline(sb);
  const frames = Math.round(duration * fps);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const renderer = createRenderer(canvas, { image });
  const config = await pickCodec(width, height, fps, bitrate || Math.round(width * height * fps * 0.27));
  const music = await renderMusic(sb, duration).catch(err => { console.warn('music skipped', err); return null; });

  const { Muxer: M, ArrayBufferTarget } = Muxer();
  const target = new ArrayBufferTarget();
  const muxer = new M({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: music ? { codec: 'aac', numberOfChannels: 2, sampleRate: music.sampleRate } : undefined
  });
  let failure = null;
  const video = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
  video.configure(config);

  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) { video.close(); throw new Error('Export cancelled'); }
    if (failure) throw failure;
    renderer.draw(sb, i / fps);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    video.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (video.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1));
    if (i % 5 === 0) { onProgress(i / frames, `Rendering frame ${i + 1} of ${frames}`); await new Promise(r => setTimeout(r, 0)); }
  }
  await video.flush(); video.close();
  if (failure) throw failure;

  if (music) {
    onProgress(0.98, 'Adding music');
    const audio = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { failure = e; } });
    audio.configure({ codec: 'mp4a.40.2', sampleRate: music.sampleRate, numberOfChannels: 2, bitrate: 192_000 });
    const block = 4096, L = music.getChannelData(0), R = music.numberOfChannels > 1 ? music.getChannelData(1) : L;
    for (let at = 0; at < music.length; at += block) {
      const n = Math.min(block, music.length - at);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(at, at + n), 0); data.set(R.subarray(at, at + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: music.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(at / music.sampleRate * 1e6), data });
      audio.encode(ad); ad.close();
    }
    await audio.flush(); audio.close();
    if (failure) throw failure;
  }
  muxer.finalize();
  onProgress(1, 'Done');
  return new Blob([target.buffer], { type: 'video/mp4' });
}

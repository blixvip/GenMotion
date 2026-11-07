import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_DRAW } from '../web/engine/layers.mjs';

// A context that accepts every canvas call and records nothing: enough to run glass() headlessly.
function fakeCtx(canvas) {
  const store = {};
  const proxy = new Proxy(store, {
    get(t, p) {
      if (p === 'canvas') return canvas;
      if (p in t) return t[p];
      return () => proxy;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return proxy;
}

test('glass() reuses one scratch canvas instead of allocating one per frame', () => {
  const created = [];
  const realDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      const c = { width: 0, height: 0 };
      c.getContext = () => fakeCtx(c);
      created.push(c);
      return c;
    },
  };
  try {
    const main = { width: 1920, height: 1080 };
    const ctx = fakeCtx(main);
    const layer = { type: 'glass', style: 'circle', size: 0.4, zoom: 1.6 };
    for (let i = 0; i < 5; i++) {
      LAYER_DRAW.glass({ ctx, W: 1920, H: 1080, u: 1, layer, lt: 0.5 + i / 30, d: 4 });
    }
    assert.ok(created.length <= 1, `glass() allocated ${created.length} canvases for 5 frames`);
  } finally {
    globalThis.document = realDocument;
  }
});

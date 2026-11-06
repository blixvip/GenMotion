# Contributing to GenMotion

Thanks for helping! Questions and ideas are welcome in the **[Discord](https://discord.gg/zEB4VjmfSb)**, and bugs go in [GitHub issues](https://github.com/blixvip/GenMotion/issues/new).

## Finding something to work on

- [Good first issues](https://github.com/blixvip/GenMotion/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are small and list the files to touch.
- [Help wanted](https://github.com/blixvip/GenMotion/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) issues are bigger.
- Comment on the issue to claim it so two people don't build the same thing. If you go quiet for a week, it opens up again.
- Have your own idea? For anything larger than a bug fix or a new provider adapter, open an issue or ask in the Discord first.

By contributing, you agree your work is released under the project's [MIT License](LICENSE).

## Setup

You need **Node.js 22** (Node 20 is the documented minimum, but `npm test` doesn't run on it yet; there's an open issue) and **Chrome or Edge** for MP4 export (WebCodecs). There are no dependencies to install.

```sh
git clone https://github.com/<you>/GenMotion.git
cd GenMotion
npm start            # http://127.0.0.1:4520 — add --open to launch the browser
npm run dev          # same, restarting on change
```

You don't need API keys to develop. With none set, an offline planner writes storyboards and you can upload images and export. To try real models, paste keys under **API keys** in the studio, or copy `.env.example` to `.env`.

## Before you open a pull request

```sh
npm test             # unit tests in test/: storyboard, director, env, every provider against a scripted fake API
npm run check        # end-to-end: throwaway server + library, drives the HTTP API, no keys or network
```

- Keep changes small and focused. One fix or feature per pull request.
- Check UI changes in Chrome or Edge and add a screenshot or GIF.
- There is no linter or formatter. Match the style of the file you're editing: dense, two-space indent, single quotes, semicolons.
- **Zero runtime dependencies** is a feature. Don't add an npm dependency without explaining why in the pull request.
- **Renderer code must be deterministic.** A frame is a pure function of `(storyboard, time)`, and preview and export share it. No `Date.now()`, `Math.random()` or timers in `web/engine/`.
- **Keys never reach the browser.** The browser gets `set`/`not set` and a masked hint only. Don't weaken `trusted()` in `server/index.mjs` (localhost Host check + same-origin check for writes).
- New storyboard fields need a default and a clamp in `normalize()`, because director output and imported files go through it.
- Never commit `.env`, anything under `library/`, or exported videos.
- Third-party code goes in `web/vendor/` with its license noted in `web/vendor/LICENSES.md`.

### Adding an image model

One file in `server/providers/image/`, one line in `IMAGE_PROVIDERS` in `server/providers/index.mjs`, and a scripted-fake test in `test/providers.test.mjs`. The README's "Add a model" section has a template. Bump the provider count asserted in `scripts/check.mjs` too.

## Where things live

- `server/index.mjs`: the zero-dependency HTTP server. Static files, the `/api/*` routes, `trusted()` (Host/Origin guard) and the error-to-status mapping
- `server/env.mjs`: `.env` parsing (`parseEnv`), loading, and `saveKey`, which the API keys panel writes through
- `server/library.mjs`: images and projects on disk under `library/` (images get a JSON sidecar, file type is sniffed)
- `server/director.mjs`: the director system prompt, JSON extraction from model replies, picking a director, and the keyless `offlinePlan()`
- `server/providers/`: `util.mjs` (`request`, `poll`, `SIZES`, `ProviderError`), one adapter per image model in `image/`, and every text-model director in `llm/index.mjs`
- `web/engine/storyboard.mjs`: the storyboard schema, `LAYERS` definitions, `normalize()` and `timeline()`. Shared by the server and the browser.
- `web/engine/render.mjs` and `layers.mjs`: the canvas renderer (backgrounds, camera moves, transitions, grain) and the 17 motion layers
- `web/engine/export.mjs`: frame-by-frame WebCodecs H.264/AAC encode, muxed with `web/vendor/mp4-muxer.js`
- `web/app.mjs`, `index.html`, `app.css`: the studio UI. `window.genmotion` is a test hook for driving it headlessly.
- `test/`: `node:test` unit tests. `scripts/check.mjs`: the end-to-end server check.

Made something with it? Show it off in the [Discord](https://discord.gg/zEB4VjmfSb).

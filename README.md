# Dials

A small browser tool for generating clean, black-and-white dial scale graphics. Pick a shape, dial in the range and graduations, and download the result as a vector `.svg` or a 2× `.png`.

**Live:** https://artofpilgrim.github.io/Dials/

## Features

- **Shapes** — straight line (horizontal or vertical), semi-circle, custom arc (any start angle + sweep), full circle.
- **Range & graduations** — set min/max, major step, and the number of minor subdivisions between adjacent majors. Tick values round relative to `min` (e.g. range `3–23` step `10` yields `3, 13, 23`, not `0, 10, 20`).
- **Rim** — on/off with adjustable thickness. Tick endpoints extend through the rim so corners close flush instead of leaving a notch.
- **Numbers** — toggle, size, offset, weight (100–900), unit suffix (e.g. `°`, `%`, `mph`), and per-tick custom labels (`L, M, H` …) that override the numeric value at any index.
- **Center** (arc / semi / circle) — optional **hub dot** with adjustable size and optional **title text** with its own size, weight, and vertical position offset so it can clear the hub.
- **Reverse direction** — flip the value mapping for counter-clockwise reading or max-at-start straight lines.
- **Invert** — render white-on-black; flows through to the exports.
- **Canvas** — manual width/height plus one-click texture sizes (512 / 1024 / 2048) for Substance Painter and other PBR workflows.
- **Presets** — save the current configuration to `localStorage` and reload it later. Older presets auto-migrate when the schema evolves.
- **Shareable links** — every config change is encoded into the URL `#hash`; sharing the URL reproduces the exact dial. `hashchange` is honoured so back/forward and pasted URLs work.
- **Zoom / pan preview** — mouse wheel zooms at the cursor; click-drag pans; on-screen `−` / % / `+` / Fit controls.
- **Export** — download as `.svg` (vector, editable in any vector tool), as `.png` at 2× the canvas resolution, or copy the SVG markup straight to the clipboard for pasting into Figma / Illustrator.

### Sidebar UX

- **Collapsible sections** — click a heading to fold it; open/closed state persists per section in `localStorage`.
- **Editable slider values** — every slider has an inline numeric input next to its label. Values are clamped to the slider's range on commit; intermediate keystrokes don't poison the renderer.

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # produces dist/
npm run preview  # serves dist/ for sanity checking the build
```

## Project structure

```
.
├── index.html              # Vite entry; lean shell + <noscript> fallback
├── src/
│   ├── main.jsx            # ReactDOM root
│   ├── App.jsx             # State, controls, presets, zoom, export
│   ├── Dial.jsx            # SVG renderer (straight + arc + circle)
│   └── styles.css          # All styles
├── vite.config.js          # base: '/Dials/' for the GitHub Pages subpath
├── .github/workflows/
│   └── deploy.yml          # Builds with Vite, publishes via actions/deploy-pages
└── package.json
```

## Deployment

Every push to `main` triggers a GitHub Action that runs `npm ci && npm run build` and publishes `dist/` via the official `actions/deploy-pages` workflow. Pages is configured with `build_type: workflow` (set once via the GitHub API; not stored in the repo).

If you fork this and want to deploy under a different repo name, change the `base` in [vite.config.js](vite.config.js) to match your new subpath (e.g. `/your-repo-name/`).

## Notes

- Stack: React 18 + Vite. The original prototype loaded React + Babel-standalone from a CDN; the Vite build cut the runtime from ~3 MB to ~54 KB gzipped.
- The renderer is pure SVG — no canvas, no third-party drawing library.
- The tick loop is hard-capped at 5000 ticks to keep misconfigured ranges from freezing the UI, and `min`/`max` are coerced to numbers with a fallback span so equal or inverted ranges never produce NaN coordinates.
- The preview wrapper is sized via `ResizeObserver` so the canvas always fills the available stage area while preserving its aspect ratio.
- Persisted storage:
  - `dialMaker.presets.v1` — saved presets (current dial config is intentionally **not** included; view state and presets stay separate).
  - `dialMaker.section.<id>` — open/closed state per sidebar section.
- URL hash format: the full `p` state object, JSON-stringified then base64-encoded.

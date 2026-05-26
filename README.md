# Dials

A small browser tool for generating clean, black-and-white dial scale graphics. Pick a shape, dial in the range and graduations, and download the result as a vector `.svg` or a 2× `.png`.

**Live:** https://artofpilgrim.github.io/Dials/

## Features

- **Shapes** — straight line (horizontal or vertical), semi-circle, custom arc (any start angle + sweep), full circle.
- **Range & graduations** — set min/max, major step, and the number of minor subdivisions between adjacent majors.
- **Rim** — on/off with adjustable thickness. Tick endpoints extend through the rim so corners close flush instead of leaving a notch.
- **Numbers** — toggle, size, offset, weight (100–900), unit suffix (e.g. `°`, `%`, `mph`), and per-tick custom labels (`L, M, H` …) that override the numeric value at any index.
- **Title** — optional centre text on arc/semi/circle dials, with its own size and weight.
- **Reverse direction** — flip the value mapping for counter-clockwise reading or max-at-start straight lines.
- **Invert** — render white-on-black; flows through to the exports.
- **Presets** — save the current configuration to `localStorage` and reload it later. Older presets auto-migrate when the schema evolves.
- **Zoom / pan preview** — mouse wheel zooms at the cursor; click-drag pans; on-screen `−` / % / `+` / Fit controls.
- **Export** — `.svg` (vector, editable in any vector tool) or `.png` at 2× the configured canvas resolution.

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

- Stack: React 18 + Vite. The original prototype loaded React + Babel-standalone from a CDN; the Vite build cut the runtime from ~3 MB to ~53 KB gzipped.
- The renderer is pure SVG — no canvas, no third-party drawing library.
- Tick rounding is computed relative to `min` (so a range like 3–23 with step 10 yields 3, 13, 23, not 0, 10, 20), and the tick loop is hard-capped at 5000 ticks to keep misconfigured inputs from freezing the UI.
- Presets are stored under `localStorage['dialMaker.presets.v1']`. View state (zoom/pan) is intentionally **not** saved with presets.

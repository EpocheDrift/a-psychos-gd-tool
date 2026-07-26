# Browser and WebGPU smoke tests

The browser checks freeze the pre-Agent human editing and rendering baseline.
They run against an isolated temporary Chrome context and explicitly seed or
clear `gfx.document.v1` and `gfx.document.v2`, so results never depend on a
developer's existing localStorage.

The shared harness also isolates optional font network behavior. It serves the
missing `/fonts/Inter-Regular.otf` request with the already bundled fallback
font bytes and answers the Google Fonts stylesheet request with empty CSS.
That reproduces the clean-checkout render fallback without changing product
code or depending on internet access; all other requests continue normally.

## Prerequisites

- Node.js 20.19+ or 22+ and dependencies installed with `npm ci`;
- Chrome or Chromium with a working WebGPU adapter;
- a localhost or HTTPS URL, because WebGPU requires a secure context;
- the Vite development build for checks that use the temporary read-only
  `__render` evidence hook or the legacy `__app` smoke hook. A production URL
  intentionally exposes neither hook.

The launcher checks `CHROME` first, then common Chrome/Chromium locations on
macOS, Linux, and Windows. It never adds `--no-sandbox`.

## Run

Use two terminals:

```sh
# terminal 1
npm run smoke:serve

# terminal 2
npm run smoke:all
```

`smoke:serve` is the canonical local test server:
`http://127.0.0.1:5199/`, with a strict port so a collision fails rather than
silently moving the server.

Individual checks:

| Command | Gate |
| --- | --- |
| `npm run smoke:baseline` | Renders the reviewed 256×192 Shape fixture; checks PNG dimensions, colors, alpha coverage, bounds, tolerant pixel drift, and page/console errors. |
| `npm run smoke:factory` | Boots from empty storage; checks the 4-layer, 42-node, 38-edge factory document and bundled image. |
| `npm run smoke:frame` | Changes the factory frame through the human UI; asserts the 1024×3508 canvas plus expected frame-independent HITs and frame-aware MISSes. |
| `npm run smoke:blur` | Edits `blur1` in its explicit layer, waits for a cache miss, and proves no phantom node was created. |
| `npm run smoke:fringe` | Loads the legacy v1 fixture, renders white-on-white, and rejects any dark fringe in the native PNG readback. |
| `npm run smoke:interaction` | Exercises pan, zoom, marquee selection, cross-platform Shift-add, group movement, delete, and undo. |
| `npm run smoke:render` | Churns revisions, retries, and frame sizes; proves coalescing, exact terminal tickets, last-known-good display, and bounded GPU-pool recovery. |
| `npm run smoke:agent-ui` | Runs the semantic Text → Outline → Rasterize → Output workflow 50 times, captures exact PNG/WebP evidence and metrics, checks rejected wiring/stale capture, exercises keyboard parameters/fonts/layers plus app-owned pan/zoom controls, scans accessibility, and verifies 20-node collision-free placement. |

The default is headless Chrome. Set `SMOKE_HEADED=1` to watch a run.

## Configuration and artifacts

| Variable | Meaning |
| --- | --- |
| `CHROME` | Explicit Chrome/Chromium executable path. |
| `SMOKE_URL` | App URL; defaults to `http://127.0.0.1:5199/`. A positional URL argument takes precedence. |
| `SMOKE_HEADED=1` | Run with a visible browser window. |
| `SMOKE_TIMEOUT_MS` | Puppeteer action/navigation timeout; default 20 seconds. |
| `SMOKE_ARTIFACT_DIR` | Screenshot directory; defaults to an OS temporary directory. |
| `AGENT_UI_ROUNDS` | Debug-only override from 1 through 50 for `smoke:agent-ui`; omitted means the required 50-round acceptance gate. Reduced runs are not release evidence. |

The reviewed visual fixture is
`test/fixtures/screenshots/visual-small-frame.png`. Update it only after
reviewing a deliberate render change:

```sh
UPDATE_SCREENSHOTS=1 npm run smoke:baseline
npm run smoke:baseline
```

The gate does not rely on compressed PNG bytes alone. It combines native frame
dimensions, tolerant color/geometry metrics, decoded-pixel comparison, and the
reviewed image. Up to 0.2% of pixels may differ by more than two channel values
to absorb isolated GPU edge-antialiasing differences; the largest delta remains
diagnostic and the semantic color/bounds checks still gate the run.

## CI status

Every pull request runs typecheck, Vitest, and the production build. WebGPU
smokes remain a required local/manual gate until a reliable GPU runner is
configured; `ubuntu-latest` must not be treated as evidence that a real WebGPU
render occurred.

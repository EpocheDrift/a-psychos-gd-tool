# Browser, Agent-controller, and WebGPU smoke tests

The browser checks freeze the human editing/rendering baseline and exercise the
paired Agent controller. They run against an isolated temporary Chrome context
and explicitly seed or clear `gfx.project`, `gfx.document.v1`, and
`gfx.document.v2`, so results never depend on a developer's existing
localStorage.

The shared harness also isolates network behavior and blocks every
cross-origin request. Production artifact checks forbid Google Fonts URLs,
third-party scripts, and Node-native model/image packages in browser bundles.

## Prerequisites

- Node.js 22.12+ and dependencies installed with `npm ci`;
- Chrome or Chromium with a working WebGPU adapter;
- a localhost or HTTPS URL, because WebGPU requires a secure context;
- the explicit built Agent artifact. `smoke:serve` builds `dist-agent` and uses
  Vite preview; Vite source-development Agent mode fails closed. No check uses
  `__app`, `__render`, or a raw store binding.

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
silently moving the server. It serves the static Agent artifact with the
production CSP and security headers.

Individual checks:

| Command | Gate |
| --- | --- |
| `npm run smoke:baseline` | Renders the reviewed 256×192 Shape fixture; checks PNG dimensions, colors, alpha coverage, bounds, tolerant pixel drift, and page/console errors. |
| `npm run smoke:example` | Proves empty storage starts with the one-layer blank project, then loads the 4-layer, 42-node, 38-edge poster example through the real **start from…** UI and checks its bundled image. (`smoke:factory` remains an alias.) |
| `npm run smoke:controller` | Verifies headers, paired scope grant, token replay/failure paths, revoke, session-local transactions, exact preview handles, absence of legacy globals/secrets, and fail-closed model execution. |
| `npm run smoke:frame` | Explicitly loads the poster fixture, changes its frame through the human UI, and asserts the 1024×3508 canvas plus expected frame-independent HITs and frame-aware MISSes. |
| `npm run smoke:blur` | Explicitly loads the poster fixture, edits `blur1` in its layer, waits for a cache miss, and proves no phantom node was created. |
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

Every pull request runs typecheck, Vitest, the default and Agent production
builds, the compiled MCP authority gate, a real child-process stdio-to-browser
MCP E2E, the compiled companion stdio lifecycle check,
`check:agent-artifacts`, and the stable `smoke:baseline` plus `smoke:frame`
WebGPU subset. The MCP E2E exercises the enabled read, preview, edit,
asset, and model handlers through the official stdio client transport,
including in-app browser-trusted approval, exact preview bytes, pinned
same-origin model routing, exact-ticket node clipping measurement, revert,
revoke, and teardown. The local
`check:agent-build` additionally uses real Chrome to verify the
default/wrong-origin paths and prove that dynamically importing the Agent HTML
entry exposes no raw store namespace. Full WebGPU visual smokes remain a
required local/manual gate until a reliable GPU runner is configured;
`ubuntu-latest` must not be treated as evidence that a real WebGPU render
occurred.

The scope UI relies on browser-trusted events to reject page-script synthetic
approval. That is not physical-user proof: CDP input can also be trusted. The
MCP companion exposes neither CDP/browser input nor page evaluation; stronger
browser-controller threat models require an out-of-band native, WebAuthn, or OS
confirmation.

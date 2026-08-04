# Getting started

[简体中文](getting-started.zh-CN.md)

This guide takes you from a fresh clone to a first working poster, then connects
an AI Agent through the local MCP companion. No prior node-editor experience is
required.

## What you need

- Node.js 22.12+ (Node 22 is the CI reference environment)
- A WebGPU browser: Chrome/Edge 113+ or Safari 18+
- Git
- For the Agent workflow: an MCP client such as Codex or Claude Code, plus a
  WebGPU-capable Chrome/Chromium installation

The documented setup and CI paths cover macOS and Linux. The companion includes
Windows Chrome discovery, but the repository setup script is POSIX-only;
Windows users should build from WSL/Git Bash or perform the equivalent npm
steps themselves. Windows is not yet a CI reference platform.

The original upstream demo is useful for exploring its human UI, but it does
not include this distribution's Agent/MCP additions. The Agent/MCP workflow is
local-only because the companion starts a loopback app and an isolated browser
session.

## Clone and run the Web UI

Copy the repository URL from GitHub, then run:

```sh
git clone <repository-url> a-psychos-gd-tool
cd a-psychos-gd-tool
./scripts/setup.sh
npm run dev
```

Open the URL printed by Vite in a WebGPU browser. `setup.sh` checks Node,
verifies the bundled font and license, and installs the exact lockfile. It is
safe to run again and does not download mutable build inputs.

This source-development UI normally appears at `http://localhost:5173` (Vite
prints the actual port). It is for human development and intentionally has no
Agent bridge. When you later start the MCP companion, it serves another full UI
at the fixed `http://127.0.0.1:5199`; that 5199 window is the shared workbench
where the human and Agent edit the same document. You do not need to keep 5173
running for an Agent session. The visible 5199 window opens at a useful initial
size but follows the native Chrome viewport: resize it or use browser zoom as
you would with an ordinary app. The node editor and preview can be resized with
the separator between them, and they stack in a narrow window. The artboard
continues to preserve the document Frame ratio. At very high zoom or very short
window heights, scroll the workbench vertically to reach both panes. Temporary
window constraints do not replace your preferred split when you return to a
larger window.

Open 5199 through the Chrome window launched by the companion. A normal browser
tab typed manually at that address has no process-local authentication cookie
and correctly receives `401 Unauthorized`; it is not a second way to join the
same session.

The app opens with a blank project already rendering: one layer with one
**Output** node. The left side is the node graph, the right side is the
artboard, and the floating **layers** panel selects which layer graph you are
editing. To inspect a finished graph first, choose **Layered poster example**
from **start from…** above the artboard.

Useful canvas controls:

- Two-finger scroll pans; pinch zooms.
- Space-drag, middle-drag, or right-drag also pans.
- Left-drag on empty canvas box-selects nodes.
- Command/Ctrl-click or Shift-click adds a node to the selection.
- Delete/Backspace removes the selection.
- Command/Ctrl-Z undoes; Command/Ctrl-Shift-Z redoes.

## Make your first poster

We will build this typed pipeline:

```text
Text.out
  → Outline Text.text
  → Warp.in
  → Rasterize.vector
  → Recolor.in
  → Output.in
```

### 1. Use the blank layer

The initial layer already contains an opaque white **Output** node, so you can
build the pipeline directly on it. If you add another layer with `+`, its
Output starts transparent so the layers below remain visible. For a standalone
poster on that new layer, turn off **transparent** and choose a background
color.

### 2. Add the five processing nodes

Open the relevant groups in the palette and click:

1. **Assets → Text**
2. **Conversion → Outline Text**
3. **Vector ops → Warp**
4. **Conversion → Rasterize**
5. **Raster ops → Recolor**

Each button places a node in an open part of the current view. Drag the node
headers to arrange them from left to right. Reuse the Output node that came with
the layer.

### 3. Connect the sockets

Drag from each output handle to the next input handle:

1. `Text.out` → `Outline Text.text`
2. `Outline Text.out` → `Warp.in`
3. `Warp.out` → `Rasterize.vector`
4. `Rasterize.out` → `Recolor.in`
5. `Recolor.out` → `Output.in`

Socket colors represent value types. An invalid type or a connection that would
create a cycle is rejected rather than silently converted.

### 4. Design

Try these controls:

- **Text:** change `content`, `fontSize`, `weight`, and `fill`.
- **Warp:** change `axis`, `amplitude`, `wavelength`, and `phase`.
- **Recolor:** choose a dark and light color for the duotone ramp.
- **Output:** choose whether the layer is transparent and, if not, its
  background color.
- **Frame:** use the controls above the artboard to choose a preset, enter width
  and height, or swap orientation.

The artboard re-renders as parameters change. Rasterize is the explicit
vector-to-pixel boundary; Recolor therefore accepts its output, but it cannot
accept the live Text or vector Warp output directly.

## Save, load, and export

The project controls above the artboard serve different jobs:

- **start from…** replaces the current project with a fresh blank project or a
  bundled example after confirmation. Save first if you want to keep the
  current graph.
- **save project** downloads a portable `.gfxproject.json` file, including
  embedded image assets. Keep this if you want to edit the graph later.
- **load project** replaces the current document with a compatible project
  file. Save first if you need the current work.
- **export png** downloads the exact current rendered poster. It is enabled only
  after the current document revision has finished rendering.

The app also keeps versioned working data in browser storage. Treat the
downloaded project file—not browser storage—as the portable backup. This is
especially important on 5199: the companion uses a temporary isolated browser
context, so save a project file before closing the companion or its Chrome
window if you want to continue in a later session.

The project `schemaVersion` identifies the document/storage envelope, not
forward compatibility with every older application build. Unknown newer node
types or parameters fail closed. A project that uses the new Place anchor
fields therefore requires a build whose capability manifest advertises those
fields; older anchor-less projects continue to load with `legacy` behavior.

## Three things to try next

### Circular or wavy type

Build two lanes into Place:

```text
Text → Split ───────────────→ Place.elements
Math Function ──────────────→ Place.layout
Place.out → Output.in
```

Split turns the word into separate live-text elements. Math Function supplies
circle, spiral, or wave slots, and Place assigns the characters to those slots.

### A repeated shape system

```text
Shape → Duplicator ─────────→ Place.elements
Grid ───────────────────────→ Place.layout
Place.out → Output.in
```

Change the polygon, copy count, grid tracks, gaps, and Place bindings. Add
Random after Grid for seeded offset, rotation, or scale variation.

Place defaults to the historical `legacy` origin so existing projects do not
move. For predictable alignment, set `anchorX` to `start`, `center`, or `end`
and `anchorY` to `top`, `middle`, or `bottom`. The selected point on the
element's painted bounds lands on the assigned slot; `offsetX/Y` then moves
that target in frame pixels (positive X is right, positive Y is down). Raster
elements use their full centered storage rectangle, including transparent
pixels, rather than detecting the opaque subject.

### An image-effects poster

```text
Image → Blur → Dither → Recolor → Output
```

Click **upload** on the Image node and choose a PNG, JPEG, or WebP. Try changing
the Image fit/scale and then the effect parameters. A more advanced version can
use Remove Background, which runs the RMBG-1.4 model and may require a first
model download.

## Connect an Agent in about 10 minutes

Codex users who want both the repository-local aesthetic Skill and the MCP
execution surface should start with the [Codex Quick Start](codex-quickstart.md).
This section is the host-neutral permission, lifecycle, and troubleshooting
walkthrough. Connecting MCP alone does not install or replace the Skill.

The MCP companion provides a deliberately narrow design API. It does not expose
shell, arbitrary filesystem, arbitrary network, browser navigation, page
evaluation, or pointer-control tools. Your MCP host may have its own separate
permissions; the companion still accepts only its named `gfx_*` operations and
the scopes granted either by the interactive browser approval or by an
explicit Trusted Local startup profile.

The companion communicates with the MCP host over stdio and owns a fixed local
HTTP/WebSocket origin at `127.0.0.1:5199`. The Chrome window it opens contains
the complete Web UI, not an Agent-only copy: keep that window visible to review
or make human edits while the Agent works on the same document. Window resize,
browser zoom, and the workbench separator change only how the UI is displayed;
they do not change Frame pixels or the exact revision preview returned by MCP.

### 1. Build the Agent artifacts

From the repository root:

```sh
./scripts/setup.sh
npm run build:agent
npm run build:mcp
```

### 2. Choose one launch method

Do not use both methods for the same session.

#### Method A — let the MCP client launch it (recommended)

For Codex, this exact command registers the full personal-workspace profile.
Run it from the repository root after the build:

```sh
codex mcp add graphic-design -- \
  "$(command -v node)" \
  "$PWD/packages/mcp-companion/dist/index.js" \
  --profile=full-design-v1 \
  --trusted-local
codex mcp list
```

The absolute executable path avoids a common Desktop/NVM `PATH` mismatch. See
the [Codex Quick Start](codex-quickstart.md) for Skill discovery, the first
combined prompt, updates, and removal.

For other MCP clients, configure the absolute path to the built entry point:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/a-psychos-gd-tool/packages/mcp-companion/dist/index.js"
  ]
}
```

Reload or restart the MCP client after changing its configuration. The client
owns the stdio process and launches it when needed. Do **not** also run
`npm run mcp:start` in another terminal.

For your own local workspace, you can make MCP startup itself the approval and
give the Agent the complete versioned design profile:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/a-psychos-gd-tool/packages/mcp-companion/dist/index.js",
    "--profile=full-design-v1",
    "--trusted-local"
  ]
}
```

This opens the same visible 5199 workbench and pairs automatically with
`read`, `preview`, `edit`, `assets`, and `model`. The session lasts until it is
revoked, the page/Companion closes, or the fixed 12-hour limit is reached.
Future scopes are not silently added to `full-design-v1`.

#### Method B — start it manually

For direct inspection or debugging:

```sh
npm run mcp:start
```

This builds and starts the same stdio companion. Do not simultaneously
configure another client to launch a second copy: only one process can own the
fixed `127.0.0.1:5199` port.

The following sections 3–5 describe the interactive least-authority path.
Trusted Local users can skip its pairing and restart steps; the prompts and
tool explanations still apply.

### 3. Start read-only

With no flags, the companion requests only `read` and `preview`. Its seven tools
can inspect the capabilities/document/render state, validate the document,
await a render, capture a preview, and measure rendered-node clipping.

When the isolated Chrome window opens:

1. Wait for the approval dialog to appear in the 5199 browser workbench.
2. Review the requested scopes, which are selected by default.
3. Click **Allow Agent control** once.

Open **Advanced details** only when you want to remove an individual scope.

Pairing is required again after a process restart, page reload, 30-minute
expiry, transport loss, or **Revoke now**.

Use this as the first prompt:

> First call `gfx_get_capabilities` and `gfx_get_document`. Do not modify
> anything. Tell me the current frame, revision, layers, and available node
> types, then wait for my approval.

### 4. Add edit permission when you are ready

Stop the read-only session. For a client-managed process, exit and relaunch the
Codex CLI (`/exit` or `/quit`), choose **Restart** in the desktop app's
**Settings → MCP servers**, or choose **Restart extension** in the IDE. For a
manual `npm run mcp:start` process, press Ctrl-C in its terminal. Then add
`--allow-edit` to the configured `args`:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/a-psychos-gd-tool/packages/mcp-companion/dist/index.js",
    "--allow-edit"
  ]
}
```

For manual launch, use:

```sh
npm run mcp:start -- --allow-edit
```

Reconnect and choose **Allow Agent control** in Chrome. The requested `edit`
scope is selected by default; command-line allowance and the browser grant are
both still required in interactive mode.

Use this as the first write prompt:

> Read the current document and capabilities first. Create a new layer without
> changing existing layers. In one atomic transaction, build
> Text → Outline Text → Warp → Rasterize → Recolor, then connect Recolor to the
> new layer's automatic Output node with node ID `out`. Reuse that Output; do
> not add another one. Use a stable request ID and the current expected
> revision. Wait for the exact committed render revision, capture a preview,
> and report the created layer/node IDs, chosen parameters, and final revision.

Every write is revision-checked, atomic, and idempotent. A successful commit and
a successful render are separate facts, so asking the Agent to await the exact
render before previewing prevents stale visual evidence. Every `add_layer`
command creates exactly one transparent Output node at node ID `out`; the
command's `clientRef` refers to the layer, not to this automatic node.

For layouts that may run off the artboard, the Agent can inspect objective
geometry before judging the image:

1. Call `gfx_await_render` and keep its exact `revision` and `attempt`.
2. Call `gfx_measure_rendered_nodes` with that ticket and up to 32
   `layerId`/`nodeId` targets. Measure a live `Place.out`, text, or vector
   output before Rasterize whenever possible.
3. Use `unclippedBounds`, `visibleBounds`, and `clipping.overflowPx` to correct
   accidental frame clipping, then capture the preview for visual review.

The measurement is a conservative painted-geometry axis-aligned box in
top-left frame pixels. It checks only intersection with the frame: it does not
calculate occlusion by other content and does not score composition or
aesthetics. Raster outputs report `unavailable` because their outside-frame
pixels may already have been discarded.

The capability manifest advertises a separate bounded, fail-soft measurement
work budget shared by one render snapshot. If that snapshot exhausts the
budget, affected targets report `bounds-limit-exceeded` without granting the
Agent more render authority.

These bounds describe exactly the selected node output before downstream
processing. A later Rasterize, Trace, centering step, or transform can change
the final composite position, so measure the latest live pre-raster output that
actually feeds the intended chain.

### 5. Grant other scopes only for a task that needs them

- In interactive mode, `--allow-assets` plus browser `assets` approval enables bounded,
  content-addressed image upload/list/metadata/remove tools. A host Agent can
  read a user-approved local file with its own permissions, then pass the bytes
  through `gfx_put_asset`; the companion itself does not gain general
  filesystem access.
- In interactive mode, `--allow-model` plus browser `model` approval enables the pinned local
  RMBG-1.4 status/preparation tools. The first download still requires a
  separate human license review and click in Chrome.

Flags can be combined for interactive least-authority sessions. For a personal
workflow that intentionally grants all current MCP design scopes, use
`--profile=full-design-v1 --trusted-local`. The profile is an immutable v1
scope snapshot, and the first RMBG download/license confirmation remains a
separate human action.

## Common problems

### WebGPU is unavailable

Use a supported browser and check that hardware acceleration/WebGPU is enabled.
The UI cannot render the poster without WebGPU.

### The app says no font was found

Run:

```sh
npm run check:font
```

If verification fails, restore `public/fonts/JetBrainsMono-Regular.ttf` from
git, then restart the development server.

### A wire will not connect

Check the socket names and colors. The graph allows compatible types only and
rejects cycles. Remember the explicit conversion ladder:
`text → vector → raster`.

### The factory artwork still appears

A new layer is transparent. Hide the older layers, or turn off
**transparent** on the new layer's Output and set its background.

### Export PNG is disabled

Wait until the latest edit finishes rendering. If a node shows an error, fix
that error first; export requires an exact render of the current revision.

### The Agent reports `PAIRING_NOT_APPROVED`

Bring the isolated Chrome window forward and approve the pending request with
**Allow Agent control**. If no request is pending, click **Connect Agent** to
reopen pairing. Page reloads and process restarts invalidate the old approval.
In Trusted Local mode, this error means the configured process/profile did not
auto-pair; restart the MCP-managed Companion with both
`--profile=full-design-v1` and `--trusted-local`, then check that the page shows
the **Trusted Local** status.

### An expected MCP tool is missing

In interactive mode, the process flag controls which tool can exist while the
browser approval controls whether it may act. Restart with the matching
`--allow-*` flag and grant the same scope. In Trusted Local mode, verify that
the versioned profile actually contains the tool; `full-design-v1` never grows
implicitly when future scopes are added.

### The Agent reports a revision conflict

Ask it to call `gfx_get_document` again and retry with the new
`expectedRevision`. Do not blindly replay a transaction against stale state.

### Port 5199 is already in use

Stop the other companion process. The fixed loopback origin is intentional and
does not fall back to another port. This is unrelated to Vite's development
port (normally 5173): 5173 is a separate human source-development build, while
the companion-owned 5199 window is the shared human-and-Agent workbench.

### A normal 5199 tab says `Unauthorized`

This is expected. The companion injects a short-lived, process-local cookie
only into the isolated Chrome context it launches. Use that launched window;
do not copy the URL into your everyday browser profile.

### Chrome does not launch

Pass an explicit executable:

```sh
npm run mcp:start -- --chrome /absolute/path/to/chrome
```

For a client-managed process, append `"--chrome"` and the absolute executable
path to `args`, or set the `CHROME` environment variable.

For the complete tool, security, lifecycle, and verification reference, see
the [local MCP companion guide](../packages/mcp-companion/README.md).

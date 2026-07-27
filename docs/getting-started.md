# Getting started

[简体中文](getting-started.zh-CN.md)

This guide takes you from a fresh clone to a first working poster, then connects
an AI Agent through the local MCP companion. No prior node-editor experience is
required.

## What you need

- Node.js 20.19+ or 22+
- A WebGPU browser: Chrome/Edge 113+ or Safari 18+
- Git
- For the Agent workflow: an MCP client such as Codex or Claude Code, plus a
  WebGPU-capable Chrome/Chromium installation

The hosted app is useful for exploring the human UI. The Agent/MCP workflow is
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
installs dependencies, and downloads the bundled free font. It is safe to run
again.

The app opens with a factory document already rendering. The left side is the
node graph, the right side is the artboard, and the floating **layers** panel
selects which layer graph you are editing.

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

### 1. Start on a clean layer

In the **layers** panel, click `+`. The new layer is selected automatically and
already contains a transparent **Output** node. Hide the factory layers with
their filled-circle visibility buttons so only your new layer is visible.

You can keep the new layer transparent to reveal layers below it. For a
standalone poster, turn off **transparent** on Output and choose a background
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

The controls above the artboard have three different jobs:

- **save project** downloads a portable `.gfxproject.json` file, including
  embedded image assets. Keep this if you want to edit the graph later.
- **load project** replaces the current document with a compatible project
  file. Save first if you need the current work.
- **export png** downloads the exact current rendered poster. It is enabled only
  after the current document revision has finished rendering.

The app also keeps versioned working data in browser storage. Treat the
downloaded project file—not browser storage—as the portable backup.

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

### An image-effects poster

```text
Image → Blur → Dither → Recolor → Output
```

Click **upload** on the Image node and choose a PNG, JPEG, or WebP. Try changing
the Image fit/scale and then the effect parameters. A more advanced version can
use Remove Background, which runs the RMBG-1.4 model and may require a first
model download.

## Connect an Agent in about 10 minutes

The MCP companion provides a deliberately narrow design API. It does not expose
shell, arbitrary filesystem, arbitrary network, browser navigation, page
evaluation, or pointer-control tools. Your MCP host may have its own separate
permissions; the companion still accepts only its named `gfx_*` operations and
the scopes you approve in the browser.

### 1. Build the Agent artifacts

From the repository root:

```sh
npm install
npm run build:agent
npm run build:mcp
```

### 2. Choose one launch method

Do not use both methods for the same session.

#### Method A — let the MCP client launch it (recommended)

Configure your MCP client with the absolute path to the built entry point:

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

#### Method B — start it manually

For direct inspection or debugging:

```sh
npm run mcp:start
```

This builds and starts the same stdio companion. Do not simultaneously
configure another client to launch a second copy: only one process can own the
fixed `127.0.0.1:5199` port.

### 3. Start read-only

With no flags, the companion requests only `read` and `preview`. Its six tools
can inspect the capabilities/document/render state, validate the document,
await a render, and capture a preview.

When the isolated Chrome window opens:

1. Click **Connect Agent**.
2. Review the requested scopes.
3. Select only the scopes you intend to grant.
4. Approve the connection.

Pairing is required again after a process restart, page reload, 30-minute
expiry, transport loss, or **Revoke now**.

Use this as the first prompt:

> First call `gfx_get_capabilities` and `gfx_get_document`. Do not modify
> anything. Tell me the current frame, revision, layers, and available node
> types, then wait for my approval.

### 4. Add edit permission when you are ready

Stop the read-only session. Add `--allow-edit` to the configured `args`:

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

Reconnect, select the `edit` scope in Chrome, and approve it. Both the
command-line allowance and the browser grant are required.

Use this as the first write prompt:

> Read the current document and capabilities first. Create a new layer without
> changing existing layers. In one atomic transaction, build
> Text → Outline Text → Warp → Rasterize → Recolor → Output. Use a stable
> request ID and the current expected revision. Wait for the exact committed
> render revision, capture a preview, and report the created layer/node IDs,
> chosen parameters, and final revision.

Every write is revision-checked, atomic, and idempotent. A successful commit and
a successful render are separate facts, so asking the Agent to await the exact
render before previewing prevents stale visual evidence.

### 5. Grant other scopes only for a task that needs them

- `--allow-assets` plus browser `assets` approval enables bounded,
  content-addressed image upload/list/metadata/remove tools. A host Agent can
  read a user-approved local file with its own permissions, then pass the bytes
  through `gfx_put_asset`; the companion itself does not gain general
  filesystem access.
- `--allow-model` plus browser `model` approval enables the pinned local
  RMBG-1.4 status/preparation tools. The first download still requires a
  separate human license review and click in Chrome.

Flags can be combined, but granting all scopes by default defeats the gradual
approval workflow.

## Common problems

### WebGPU is unavailable

Use a supported browser and check that hardware acceleration/WebGPU is enabled.
The UI cannot render the poster without WebGPU.

### The app says no font was found

Run:

```sh
./scripts/get-font.sh
```

Then restart the development server.

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

Bring the isolated Chrome window forward, click **Connect Agent**, select the
requested scopes, and approve. Page reloads and process restarts invalidate the
old approval.

### An expected MCP tool is missing

The process flag controls which tool can exist, while the browser approval
controls whether it may act. Restart with the matching `--allow-*` flag and
grant the same scope in Chrome.

### The Agent reports a revision conflict

Ask it to call `gfx_get_document` again and retry with the new
`expectedRevision`. Do not blindly replay a transaction against stale state.

### Port 5199 is already in use

Stop the other companion process. The fixed loopback origin is intentional and
does not fall back to another port.

### Chrome does not launch

Pass an explicit executable:

```sh
npm run mcp:start -- --chrome /absolute/path/to/chrome
```

For a client-managed process, append `"--chrome"` and the absolute executable
path to `args`, or set the `CHROME` environment variable.

For the complete tool, security, lifecycle, and verification reference, see
the [local MCP companion guide](../packages/mcp-companion/README.md).

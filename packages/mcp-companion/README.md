# Local MCP companion

[Beginner walkthrough](../../docs/getting-started.md#connect-an-agent-in-about-10-minutes)
· [中文入门教程](../../docs/getting-started.zh-CN.md#大约-10-分钟接入-agent)

The companion is the authenticated local adapter for the explicit Agent build.
It starts one fixed loopback app host, launches an isolated Chrome context, and
maps MCP stdio calls to the named `AgentController` operations through a
same-origin WebSocket:

```text
MCP client ↔ bounded stdio ↔ local companion
                              ↕ authenticated WebSocket
                    Chrome + full Web UI + AgentController
```

The Chrome window is the shared human-and-Agent workbench. The companion serves
that full UI at the fixed `http://127.0.0.1:5199`; edits made through MCP and
edits made by a person in that window affect the same in-memory document.

This is separate from `npm run dev`, which starts Vite's source-development UI
at the URL it prints (normally `http://localhost:5173`). The development build
intentionally excludes the Agent bridge, uses a different browser origin and
storage, and is not a page to which the companion can attach. Use the 5173 UI
for source development; use the companion-owned 5199 UI for human-and-Agent
collaboration. Two different processes also cannot listen on the same
address-and-port pair.

It does not expose Puppeteer, CDP, page evaluation, navigation, pointer input,
shell commands, arbitrary URLs, or general filesystem access as tools.

## Build once

From the repository root:

```sh
npm install
npm run build:agent
npm run build:mcp
```

After building, choose exactly one launch mode below. Do not manually run a
second companion when an MCP client is already configured to spawn it: one
companion owns one stdio stream, one fixed loopback port, and one isolated
Chrome session.

## Launch mode A: let the MCP client manage it (recommended)

Point the client at the built bin using an absolute repository path. The
read/preview profile is:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/a-psychos-gd-tool/packages/mcp-companion/dist/index.js"
  ]
}
```

Restart or reload the MCP client after changing its configuration. The client
starts and stops the companion together with its MCP connection.

Append only the scopes needed for the session:

- `"--allow-edit"` for graph transactions;
- `"--allow-assets"` for bounded PNG/JPEG/WebP ingestion;
- `"--allow-model"` for the pinned local RMBG-1.4 workflow.

For example, a poster session using a local image but not background removal
uses:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/a-psychos-gd-tool/packages/mcp-companion/dist/index.js",
    "--allow-edit",
    "--allow-assets"
  ]
}
```

For a personal local workflow where starting the configured MCP server is the
consent boundary, use the immutable full-design v1 profile together with
Trusted Local:

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

`full-design-v1` is pinned to `read`, `preview`, `edit`, `assets`, and `model`;
future scopes never enter that profile implicitly. Trusted Local auto-pairs
only the cookie-protected Companion page, lasts for at most 12 hours or until
the page/Companion closes, and keeps the visible connected state plus
**Revoke now**. The first RMBG-1.4 download and license disclosure remain a
separate human action.

## Launch mode B: run it manually for debugging

Manual foreground runs are useful for inspecting startup diagnostics or
driving stdio yourself:

```sh
npm run mcp:start
npm run mcp:start -- --allow-edit
npm run mcp:start -- --allow-assets
npm run mcp:start -- --allow-model
npm run mcp:start -- --allow-edit --allow-assets --allow-model
npm run mcp:start -- --profile=full-design-v1 --trusted-local
```

The default profile requests only `read` and `preview`. Editing, project
assets, and local model execution are independent opt-ins.

In interactive mode, the companion opens a headed Chrome window and presents
the in-app approval dialog in the 5199 browser workbench when the MCP client
requests access. Review the scopes
that are preselected and choose **Allow Agent control**. Use
**Advanced details** only when you want to remove individual scopes. The MCP
tools fail with a structured
`PAIRING_NOT_APPROVED` outcome until this happens. Approval is required again
after process restart, page reload, 30-minute session expiry, transport loss,
or **Revoke now**. Trusted Local performs this pairing automatically for its
explicit startup profile.

`--headless` exists for automated E2E. Keep ordinary and Trusted Local
sessions headed so the active scopes, shared canvas, model disclosure, and
**Revoke now** control remain visible.

An explicit Chrome can be selected with `--chrome /absolute/path/to/chrome` or
the `CHROME` environment variable. The first release launches a new isolated
Chrome session; it does not attach to an existing user profile.

Node.js 20.19 or newer and a WebGPU-capable Chrome/Chromium are required. The
host is intentionally fixed at `http://127.0.0.1:5199`; a port conflict is a
startup error, not a reason to widen or dynamically change the origin.

## Tool profiles

The default profile exposes six tools:

- `gfx_get_capabilities`
- `gfx_get_document`
- `gfx_get_render_status`
- `gfx_validate_document`
- `gfx_await_render`
- `gfx_capture_preview`

`--allow-edit` additionally exposes:

- `gfx_apply_transaction`
- `gfx_revert_transaction`

`--allow-assets` independently adds four bounded content-addressed asset
tools:

- `gfx_put_asset`
- `gfx_list_assets`
- `gfx_get_asset_metadata`
- `gfx_remove_asset`

`--allow-model` independently adds two local status tools:

- `gfx_get_model_status`
- `gfx_prepare_model`

The MCP preparation tool cannot approve or start a first download. When the
fixed model is missing it returns `MODEL_DOWNLOAD_REQUIRED` with
`CONFIRMATION_REQUIRED`; a human must review the license disclosure and click
the companion panel. That trusted POST accepts only the fixed model key,
manifest digest, license id, and a request id. It cannot receive a URL or
filesystem path.

Project replacement, arbitrary fetch, filesystem export, and per-node tools
remain absent.

Graph writes require an `edit` scope granted by interactive human approval or
an explicit Trusted Local startup profile; asset ingestion/removal requires
the independent `assets` scope. Every write carries an
`expectedRevision` and stable `requestId`, commits atomically, and is
conflict-safe and idempotent. A committed result reports project persistence
and the exact render ticket separately; no-op/dry-run results mark those side
effects not applicable. Asset finalize also distinguishes CAS deduplication
from manifest mutation.

MCP tool annotations are discovery hints only; the browser controller remains
the authorization and validation authority. Every tool success or failure,
including pre-handler SDK schema rejection, uses the common machine-readable
`structuredContent.outcome` envelope.

### New-layer Output example

`add_layer` creates the new layer with one transparent `Output` node whose node
ID is always `out`. Reuse it as the final connection target. Do not add a
second `Output`, because a renderable layer must contain exactly one.

For example, after reading revision `12`, this transaction creates and wires a
complete text layer without creating an Output node:

```json
{
  "requestId": "create_poster_layer_v1",
  "expectedRevision": 12,
  "commands": [
    {
      "op": "add_layer",
      "clientRef": "poster_layer",
      "name": "Poster"
    },
    {
      "op": "add_node",
      "layerId": { "clientRef": "poster_layer" },
      "clientRef": "headline",
      "nodeType": "Text",
      "params": {
        "content": "AGENT",
        "fontSize": 96,
        "fill": "#111111"
      }
    },
    {
      "op": "add_node",
      "layerId": { "clientRef": "poster_layer" },
      "clientRef": "outline",
      "nodeType": "Outline"
    },
    {
      "op": "add_node",
      "layerId": { "clientRef": "poster_layer" },
      "clientRef": "raster",
      "nodeType": "Rasterize"
    },
    {
      "op": "connect",
      "layerId": { "clientRef": "poster_layer" },
      "from": { "nodeId": { "clientRef": "headline" }, "socket": "out" },
      "to": { "nodeId": { "clientRef": "outline" }, "socket": "text" }
    },
    {
      "op": "connect",
      "layerId": { "clientRef": "poster_layer" },
      "from": { "nodeId": { "clientRef": "outline" }, "socket": "out" },
      "to": { "nodeId": { "clientRef": "raster" }, "socket": "vector" }
    },
    {
      "op": "connect",
      "layerId": { "clientRef": "poster_layer" },
      "from": { "nodeId": { "clientRef": "raster" }, "socket": "out" },
      "to": { "nodeId": "out", "socket": "in" }
    },
    {
      "op": "auto_layout_graph",
      "layerId": { "clientRef": "poster_layer" },
      "direction": "LR"
    }
  ]
}
```

Replace `12` with the revision returned by `gfx_get_document`. The layer's
`clientRef` resolves the new layer for later commands in the same transaction;
the automatic Output is addressed directly as node ID `out` within that layer.

## Startup and health

Startup and lifecycle diagnostics go only to stderr. Stdout is reserved for
newline-delimited MCP JSON-RPC. The companion never logs tokens, tool
arguments, document content, preview bytes, Chrome paths, or pairing secrets.

The minimal health endpoint is:

```sh
curl --fail http://127.0.0.1:5199/healthz
```

It reports only the package version and one bridge state:
`waiting-for-browser`, `waiting-for-human`, `ready`, `closed`, or `failed`.
The hosted app itself requires a process-local HttpOnly cookie that Puppeteer
sets before the fixed navigation.

## Security and lifecycle

- HTTP listens only on literal `127.0.0.1:5199`.
- Every HTTP request requires exactly `Host: 127.0.0.1:5199`.
- Every WebSocket upgrade additionally requires the exact same-origin
  `Origin`, fixed path, fixed subprotocol, and a 256-bit process-local HttpOnly
  cookie.
- Static resources are pre-enumerated from the packaged Agent artifact; there
  is no request-controlled filesystem traversal or directory listing.
- The fixed RMBG-1.4 artifacts are downloaded only after a short-lived,
  one-shot human approval, checked against pinned byte lengths and SHA-256,
  atomically promoted into the managed cache, and served only from exact
  same-origin routes. The host opens a fixed artifact id with no-follow
  semantics and verifies the same file handle before streaming it; paths and
  remote URLs never enter the MCP schema or public status.
- The WebSocket has one owner, a pre-auth hello deadline, strict per-direction
  sequence numbers, compression disabled, heartbeat expiry, and explicit
  message/rate/concurrency/preview budgets.
- Preview object URLs never leave the page. The lexical adapter resolves the
  private vault bytes, verifies SHA-256 and length, sends one bounded binary
  frame, and removes the handle. MCP receives image content plus separate
  untrusted metadata.
- Asset bytes use declared length/SHA-256 plus at most 1 MiB strict-base64
  chunks, are header/decode/pixel/dimension checked, and enter a bounded
  content-addressed store. No asset response or diagnostic echoes bytes or a
  data URI.
- The stable MCP SDK's unbounded pre-newline stdio reader is placed behind a
  bounded line transform and streaming UTF-8/JSON resource scanner; oversized,
  over-deep, or over-populated requests terminate the session before entering
  the SDK parser.
- Closing stdin or SIGINT/SIGTERM shuts down MCP, the host, and the Chrome
  session. Chrome disconnect, WebSocket loss, page hide, expiry, human revoke,
  or a hard bridge deadline destroys the browser session and releases the
  loopback host. Stdio remains open so the MCP client can receive structured
  terminal failures and close the process normally; no new browser authority
  can be acquired in that process.

Browser `Event.isTrusted` blocks page-script synthetic approval, but it is not
cryptographic proof that a physical person clicked. This is why the MCP surface
never makes CDP, navigation, evaluation, or browser input available to the
Agent. A stronger attacker model requires an out-of-band native, OS, WebAuthn,
or equivalent confirmation.

## Verification

```sh
npm run typecheck
npm test
npm run check:mcp
```

`check:mcp` builds the packaged Agent app and companion, performs an AST
authority scan with negative fixtures, then uses a real child stdio server,
WebGPU Chrome, and the official MCP client. It exercises the in-app
browser-trusted approval flow, exercises the enabled handlers, and verifies
capability discovery, an atomic Text → Outline → Rasterize → Output
transaction, structured `TYPE_MISMATCH` with no revision change,
chunked asset ingest/list/metadata/remove/revert, pinned same-origin model
worker routing, duplicate-request idempotency, separate
commit/persistence/render evidence, exact preview bytes and hash,
conflict-safe revert, revoke, redacted rejected input, and clean process
teardown.

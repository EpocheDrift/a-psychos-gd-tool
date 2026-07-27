# Agent Evaluation Suite

Status: **implemented and passing**

The evaluation suite proves that an Agent can discover, create, inspect, render,
and recover through the same bounded MCP surface used in production. It does
not call the page controller directly and it does not replace the browser
document from a fixture.

## Run it

```sh
npm run check:agent-evals
```

The command builds the Agent artifact and MCP companion, launches a fresh
Chrome context, performs the normal human approval clicks, and then runs the
official MCP client through:

```text
official MCP client
  → bounded stdio
  → local companion
  → authenticated same-origin WebSocket
  → revisioned AgentController
  → real document and render services
```

The committed golden policy is
[`test/fixtures/agent-evals/golden-v1.json`](../../test/fixtures/agent-evals/golden-v1.json).
Runtime evidence is written under `test-results/agent-evals/` and uploaded by
CI. That directory is ignored by Git.

## Scenario prompts and expected traces

### 1. Typography chain

Example prompt:

> Create a warped, recolored AGENT READY headline and render it on a
> transparent 512×384 frame.

Expected write plan:

```text
gfx_apply_transaction
  Text.out → Outline.text
  Outline.out → Warp.in
  Warp.out → Rasterize.vector
  Rasterize.out → Recolor.in
  Recolor.out → Output.in
  auto_layout_graph
gfx_validate_document
gfx_await_render
gfx_get_document
gfx_capture_preview
```

The document topology must match the golden exactly, and the exact render must
produce a nonblank preview with bounded dimensions and bytes.

### 2. Circular type

Example prompt:

> Split CIRCULAR AGENT into characters, place them around a mathematical
> circle, and render the result.

Expected write plan:

```text
gfx_apply_transaction
  Text.out → Split.text
  Split.out → Place.elements
  Function.out → Place.layout
  Place.out → Output.in
  auto_layout_graph
gfx_validate_document
gfx_await_render
gfx_get_document
gfx_capture_preview
```

`Function` is the stable node type whose human label is “Math Function.”

### 3. Masked scatter

Example prompt:

> Use an uploaded image as a mask, jitter a grid inside it, duplicate a shape
> across the layout, and render.

Expected trace:

```text
gfx_put_asset(begin)
gfx_put_asset(chunk)
gfx_put_asset(finalize)
gfx_apply_transaction
  Image.out → Grid.mask
  Grid.out → Random.layout
  Image.out → Random.mask
  Shape.out → Duplicator.in
  Duplicator.out → Place.elements
  Random.out → Place.layout
  Place.out → Output.in
gfx_validate_document
gfx_await_render
gfx_get_document
gfx_capture_preview
gfx_get_asset_metadata
```

The asset is content-addressed, the graph stores only its asset ID, and the
metadata query must report the exact graph reference.

### 4. Human edit conflict

The runner records a revision, then asks the test launcher to click the real
human “Add layer” control. A transaction planned against the old revision must
fail with `REVISION_CONFLICT`.

Expected recovery:

```text
gfx_get_document       # old Agent observation
human UI click         # revision advances outside MCP
gfx_apply_transaction  # stale; rejected atomically
gfx_get_document       # observe human layer and current revision
gfx_apply_transaction  # new requestId and current revision; succeeds
gfx_get_document       # human layer is unchanged
```

Failed requests are replay-cached too. A corrected plan therefore uses a new
`requestId`; reusing the stale ID with changed arguments correctly returns
`REQUEST_ID_REUSED`.

### 5. Bad plan recovery

The first plan attempts to connect a raster output directly to a vector input.
It must fail without changing the revision and return:

- source and target node/socket types;
- `TYPE_MISMATCH`;
- an explicit `Trace.in` / `Trace.out` conversion route;
- a reminder to submit the corrected plan with a new request ID.

The corrected trace is:

```text
Image.out → Trace.in → Trace.out → Warp.in
```

The corrected transaction must commit, and the resulting typed edges must be
visible through `gfx_get_document`.

### 6. Render failure recovery

The suite commits a valid Image → RemoveBackground → Output graph. The test
launcher exposes a ready fixed-model status but deliberately leaves the
artifact route unavailable, so the real local worker path fails predictably.

Expected recovery:

```text
gfx_apply_transaction
gfx_await_render        # failed, exact revision/attempt/node/phase
gfx_revert_transaction # responsible transaction, current head only
gfx_await_render        # complete at the new revision
gfx_get_document        # failed layer is gone
```

The public render error includes a bounded recovery hint. Revert is safe only
while the failed transaction is still the document head; it never crosses a
newer human or Agent edit.

### 7. Timed-out request replay

The test launcher lets one real browser transaction commit and enter the
session replay cache, then delays only its MCP response. The official MCP
client uses a 25 ms request timeout and observes a client-side timeout.

The identical request is then replayed inside the same live pairing:

```text
gfx_apply_transaction(requestId = agent_eval_retry_v1) # response times out
gfx_apply_transaction(same request byte-for-byte)      # original result
gfx_get_document                                      # one commit only
```

The replay must return the original revision, transaction ID, `created`, and
`createdEntities`; it must not allocate a second layer or node.

This is intentionally not the companion's own write deadline. A companion
write deadline closes the pairing because the outcome is unknown, so recovery
after reconnect starts by reading current state rather than assuming the prior
session's replay cache survived.

## Golden and preview policy

Document goldens compare normalized node types and typed edges instead of
runtime document IDs or revision numbers. Each creative scenario also checks
its important explicit parameters.

Preview evidence combines:

- exact revision and render attempt;
- PNG byte/hash agreement across MCP metadata and image content;
- bounded output dimensions and byte length;
- positive alpha coverage;
- non-background bounds;
- a minimum luminance range;
- a reviewed perceptual hash with a bounded Hamming distance.

Exact PNG and RGBA hashes are recorded in the run artifact, not used as a
cross-vendor authorization decision. GPU/browser differences must not turn a
visual similarity signal into an integrity claim. The perceptual golden allows
up to 12 differing bits out of 64; it catches a materially different or blank
composition while tolerating small rendering differences.

## Metrics

The report uses fixed definitions:

- `toolCalls`: MCP tool calls attempted by the runner;
- `invalidPlans`: semantic/type plans rejected before commit, excluding
  revision conflicts and transport/rate failures;
- `revisionConflicts`: expected stale-plan rejections;
- `retries`: a repeated request with the same request ID and fingerprint;
- `successfulRecoveries`: expected failures followed by a verified corrected
  commit or revert;
- `renderLatencyMs`: wall-clock wait for an exact render terminal state.

Trace entries contain tool name, scenario, public request ID, duration,
revision, and public outcome. They never contain asset base64, preview base64,
pairing credentials, cookies, model paths, or full child-process stderr.

## High-level helper decision

PR 8 does not add `duplicate_subgraph`, reviewed-template creation, or
asset-replacement helpers.

The traces show that each creative design is already one atomic
`gfx_apply_transaction`. `clientRef` removes ID round trips, the existing
`Duplicator` node handles repeated shapes, and `auto_layout_graph` handles
editor placement. A new helper would enlarge the trusted surface without
reducing MCP write calls. Helpers should be reconsidered only when recorded
traces demonstrate repeated multi-transaction coordination or a recurring
recovery failure.

# AI Agent Readiness Audit

Audit baseline: `main` at `3ebe269`

This is the original gap analysis for that frozen baseline, not current
delivery status. Implemented evidence is tracked in
[`delivery-checklist.md`](./delivery-checklist.md).

Audit scope: document model, node registry, state mutations, evaluator,
rendering, persistence, browser automation, assets, and external tool safety.

## Verdict

The application is **automatable but not agent-adapted**.

A browser agent can use visible controls, and test scripts can call the
development-only Zustand handle. Neither path is a stable product contract:
coordinate-based wiring is fragile, the canvas preview is opaque to DOM-only
agents, direct store calls are unvalidated, and production builds do not expose
the test handle.

The strongest foundations are the JSON-safe graph and typed node registry. The
largest gaps are a validated command boundary, revision-aware render feedback,
deep import validation, idempotent transactions, and an authenticated external
adapter.

## Evidence inventory

| Area | Existing evidence | Agent relevance |
| --- | --- | --- |
| JSON document | `src/engine/graph.ts:1-68` keeps document state free of GPU handles and functions | Good basis for snapshots, import/export, and tool arguments |
| Typed registry | `src/engine/registry.ts:8-76` describes sockets and parameter kinds | Can generate capability and JSON Schema documents |
| Wire safety | `src/store.ts:127-138` checks socket compatibility and cycles | Reusable invariant, but currently returns only a boolean |
| Mutation actions | `src/store.ts:270-449` centralizes most document edits | Useful starting point for commands |
| Undo/redo | `src/store.ts:140-267` stores document snapshots | Can back transaction-level undo |
| Persistence | `src/store.ts:70-118` and `482-490` load/write localStorage | JSON is already persisted, but only shallowly validated |
| Pull evaluator | `src/engine/evaluator.ts:75-145` records HIT/MISS events and awaits async nodes | Can expose render/cook diagnostics |
| User-facing cook state | `src/App.tsx:131-235` serializes cooks and captures errors | Needs revision IDs and a query API |
| PNG readback | `src/App.tsx:190-229` reads GPU output and encodes PNG | Can power preview/export tools |
| Browser automation | `scripts/*.mjs` use Puppeteer with a real WebGPU Chrome | Strong E2E test foundation |
| Development hook | `src/store.ts:493-496` exposes `globalThis.__app` only in DEV | Useful prototype, unsuitable as public API |
| UI semantics | palette buttons and most form controls are DOM elements | Basic GUI automation is possible |
| Visual output | artboard is a `<canvas>` in `src/App.tsx` | Requires screenshot/readback for agent perception |

## Strengths to preserve

### Pure, deterministic document structure

Node IDs, types, parameters, positions, edges, layers, and the frame are
serializable. Moving a node is excluded from content hashing, so graph layout
can be changed for readability without triggering a render. This is an
excellent separation for an agent auto-layout command.

### Registry as a partial capability schema

`NodeDef` already contains stable node type IDs, socket names/types,
optional-input flags, parameter kinds, defaults, options, and common numeric
constraints. The public capability descriptor should be derived from this
registry so the UI and agent cannot drift.

### Existing graph invariants

`wireIsValid` combines type checking with cycle prevention, while `canConnect`
handles union sockets. These rules should move behind a structured validator,
not be duplicated in the MCP server.

### Better-than-minimal accessibility semantics

React Flow already renders the editor root as an application, nodes as
focusable groups with `data-id`/`data-testid`, and edges with labels such as
`Edge from shape_5 to rasterize_6`. Native palette details/buttons and most
label-wrapped inputs also appear usefully in the accessibility tree. The
adaptation should extend these semantics instead of replacing them.

### Deterministic generators

Noise, random layouts, filters, and placement ordering use explicit seeds.
Determinism is valuable for retry safety, visual regression tests, and agent
evaluation.

### Safe expression language

`src/util/expr.ts` implements a small arithmetic parser instead of using
`new Function`. Imported or agent-authored expressions therefore do not execute
arbitrary JavaScript. Preserve this constraint.

### Existing real-browser checks

The Puppeteer scripts already launch Chrome with WebGPU, mutate state, inspect
DOM/canvas results, and take screenshots. They can evolve into end-to-end tool
contract tests instead of being replaced.

## Gaps and findings

### P0 — No supported command boundary

The Zustand actions are UI-oriented:

- commands implicitly target `activeLayerId`;
- `addNode` returns `void`, with the created ID observable only through
  selection state;
- invalid `connect` calls silently return the old state;
- `setParam` assumes the node exists and does not validate the parameter name,
  kind, enum membership, or range;
- layer update calls assume UI-provided values are valid;
- one store action normally creates one history entry, which prevents a
  multi-step agent plan from being atomic.

**Required change:** introduce pure, explicit `applyTransaction(doc, request)`
logic that returns either a new document plus metadata or a structured error.
The Zustand store becomes one consumer of that domain service.

### P0 — Validation is shallow

`validGraph` verifies that a graph has `nodes` and `edges` and that each node
type exists. It does not deeply validate:

- document/schema version;
- frame dimensions;
- layer IDs or duplicate IDs;
- node parameter names and values;
- dangling edge endpoints;
- socket existence and direction;
- socket type compatibility;
- cycles;
- required inputs;
- the per-layer Output invariant;
- resource budgets;
- asset URI policy.

An imported document can therefore pass load validation and fail later during a
cook.

**Required change:** add versioned, deep validation with separate modes for
`structural`, `editable`, and `renderable` documents.

Numeric and count bounds are mostly enforced by UI controls, not the cook
boundary. An imported or directly mutated document can bypass the advertised
maximum for Duplicator, Grid, frame fields, and other parameters; text content
also has no document-level length budget. Validation must reject non-finite
numbers and enforce both per-parameter and whole-document resource limits.

### P0 — A cyclic imported graph can bypass the UI guard

The UI refuses a connection that creates a cycle, but the persisted-document
loader does not perform the same check. In `Evaluator.cookNode`, the async body
starts traversing upstream inputs before its promise is inserted into the memo
map. A cyclic imported graph can therefore recurse rather than producing a
controlled diagnostic.

**Required change:** validate/topologically sort before commit and add a
defense-in-depth visiting set inside the evaluator that returns
`CYCLE_DETECTED`.

### P0 — Mutation success is not render success

Store mutation is synchronous, while `App.runCook` is asynchronous and may
coalesce multiple document updates behind `busyRef`/`queuedRef`. A tool caller
cannot currently answer:

- which document revision is being rendered;
- whether its own revision was skipped or superseded;
- when the requested revision completed;
- which layer/node caused a failure;
- whether a PNG corresponds to the intended revision.

**Required change:** add monotonically increasing document/render revisions and
an awaitable render coordinator.

The renderer also chooses the first `Output` found by object enumeration.
Documents with zero or multiple Output nodes are therefore missing or
ambiguous. Add an explicit per-layer output root (or enforce exactly one
Output) during migration and validation.

### P0 — No retry/idempotency contract

Agents and tool transports retry calls. Repeating `addNode` currently creates a
second node. There is no request ID cache, optimistic revision check, or
transaction result replay.

**Required change:** writes require `requestId` and `expectedRevision`; the
controller caches bounded per-session results and returns
`REVISION_CONFLICT` when the base changed.

### P1 — Production has no narrow automation surface

The `__app` global exposes the entire store in development and disappears in
production. It is suitable for internal smoke tests only.

**Required change:** expose a deliberately small `AgentController` through a
build-gated browser bridge. The bridge must never return Font objects, GPU
handles, raw store setters, or arbitrary function invocation.

### P1 — Registry metadata is not yet a complete public schema

Current gaps include:

- no human-readable parameter descriptions;
- no explicit integer kind;
- some numeric parameters omit maximum bounds;
- no string length or format constraints;
- conditional visibility is UI metadata, not a semantic dependency rule;
- no cost/risk annotations for expensive nodes;
- no documented output behavior or examples;
- cook functions and runtime-only fields must be stripped.

**Required change:** add public descriptor fields incrementally and generate a
serializable `CapabilityManifest`.

### P1 — Canvas output is opaque

The DOM exposes a canvas element but not its visual contents. A DOM-only agent
can see that rendering completed without knowing whether the poster is blank,
cropped, or visually plausible.

**Required change:** provide `capture_preview` plus inexpensive metrics:
dimensions, alpha coverage, non-background bounding box, luminance range, and
a perceptual hash. Vision-capable agents can consume the image; non-vision
agents can use the metrics as guardrails.

### P1 — GUI automation lacks stable semantics

Visible controls are generally real buttons and inputs, but graph wiring still
depends on small handle coordinates and viewport transforms. Node parameter
controls do not expose a uniform stable selector containing layer ID, node ID,
and parameter name.

**Required change:** add stable `data-agent-*`/test attributes and accessible
names for nodes, sockets, parameters, layers, frame controls, render status, and
errors. This remains a fallback adapter; core Agent operation should not depend
on pointer wiring.

### P1 — Persistence is silent and unversioned

The current `Doc` has no top-level `schemaVersion`. localStorage write failures
are intentionally swallowed, so an agent cannot know that a result was not
persisted. Image data URIs are embedded in the document and can exhaust browser
quota.

**Required change:** add schema version/migrations, explicit save/import/export
commands, persistence status, and an asset store separated from graph JSON.

### P1 — Assets become a security boundary

`Image` accepts a string source and fetches it at cook time. Today the UI mostly
produces data URIs or same-origin factory assets. Once documents arrive from an
agent, arbitrary remote URLs can introduce tracking, CORS failures, large
downloads, client-side network probing, GET side effects, and unbounded memory
use. CORS is not a defense because the request may be sent before the response
is blocked. Remove Background also triggers a model download and substantial
compute; its remote model revision/hash is not currently pinned.

**Required change:** replace arbitrary source strings in public commands with
validated `assetId` references. Enforce MIME, decoded-size, pixel-count, source,
and download policies. Do not expose URL import in the first Agent release.
Mark model-backed commands/nodes as expensive, keep them blocked until the
human grants the `model` scope, and pin/self-host model bytes with integrity
verification.

### P1 — Async work has no cancellation/deadline contract

Trace/model worker requests have no `AbortSignal`, timeout, or bounded pending
queue. An Agent tool can otherwise wait forever while an obsolete render keeps
using CPU/GPU resources.

**Required change:** add deadline/cancellation to `CookContext`, worker
requests, and the render coordinator. Cancellation must clear pending requests
and recover/recreate a failed worker when necessary.

### P1 — The texture pool needs a byte budget

Released textures remain pooled by dimensions. Repeated Agent changes across
many frame sizes can retain free GPU textures indefinitely; a single
4096×4096 RGBA texture is roughly 64 MiB before accounting for multiple passes
and visible layers.

**Required change:** account GPU bytes, add an LRU for free textures, destroy
entries over a configurable budget, rate-limit rapid frame changes, and report
device-loss/resource errors structurally.

### P2 — Document and UI identities are conflated

Agent commands should not change human selection merely to discover a created
node ID, nor should a human changing the active layer redirect an in-flight
agent command.

**Required change:** commands always take explicit layer/node IDs and return
created ID mappings. Selection remains UI-only state.

### P2 — Error strings lack remediation data

Evaluator errors are human-readable strings such as missing-input or unknown
node messages. Agent callers need stable codes, JSON paths, offending values,
recoverability, and suggested corrections.

**Required change:** introduce typed domain/render errors and translate them to
human text at the UI boundary.

## Browser-agent assessment

### What works today

- opening palette categories and clicking labeled add buttons;
- editing most inline form fields;
- selecting, deleting, undoing, changing frame size, and exporting;
- inspecting visible cook errors;
- taking a screenshot of the artboard;
- development-only direct store reads and mutations through Puppeteer.
- addressing existing nodes through React Flow's generated
  `rf__node-{id}`/`data-id` attributes and inspecting labeled edges.

### What is brittle today

- connecting handles by coordinate: sockets are styled at 8×8 CSS pixels and a
  live default `fitView` audit measured an effective hit area near 3.7×3.7
  screen pixels; selector-guided drags still failed;
- targeting a parameter after pan/zoom or node movement;
- determining whether a canvas render is semantically correct;
- distinguishing two nodes of the same type: node groups have stable IDs but no
  accessible name containing type + ID + layer;
- waiting for a specific change rather than merely any completed cook;
- handling local-font permission prompts;
- recovering from hidden/collapsed panels and responsive layout changes.
- adding several nodes: the current center-plus-small-offset placement can
  overlap cards, and floating palette/layer panels can intercept pointer input;
- editing drag-based numbers, the custom font picker, layer rows/rename/reorder,
  and glyph-only layer buttons through the keyboard/accessibility tree;
- selecting the correct preview when both the artboard and layout guide canvases
  exist.

The preview canvases have no accessible name, rendered revision, or semantic
description. The slow-render spinner announces `rendering`, but fast cooks do
not produce a terminal `complete` announcement and cook errors are not exposed
as an alert. Cook events also omit layer ID and revision, making repeated node
IDs such as `out` ambiguous across layers.

## Threat model

### Protected assets

- the user's document and undo history;
- local image and font data;
- browser storage;
- GPU/CPU/memory availability;
- filesystem paths exposed through the MCP companion;
- session credentials and bridge tokens;
- exported artwork.

### Relevant actors

- an intended local agent making mistakes;
- a prompt-injected agent attempting excessive or unrelated actions;
- an untrusted imported document;
- a malicious web page attempting to reach a localhost bridge;
- third-party scripts running in the hosted app origin;
- an accidental transport retry.

### Principal threats and controls

| Threat | Required controls |
| --- | --- |
| Duplicate mutations after retry | request ID replay cache and idempotent responses |
| Human/agent edit race | expected revision and conflict response |
| Partial graph after failed plan | atomic transaction and rollback |
| Invalid/cyclic graph | deep schema plus semantic validation |
| Destructive document replacement | explicit capability and confirmation token |
| Resource exhaustion | frame, node, element, asset, transaction, render-time budgets |
| Remote asset tracking/download | asset ingestion service and source allowlist |
| Unauthorized localhost calls | loopback bind, random session token, Origin validation |
| Raw internal access | narrow allowlisted controller; no `eval` or method-name dispatch |
| Data leakage in logs | redact data URIs, image bytes, font data, and tokens |
| Surprise model download | cost annotation and permission-required response |
| Arbitrary expression execution | preserve the fixed expression parser |
| Prompt injection in Text/preview content | label document/preview content as untrusted and never derive permissions from it |
| Agent targeting another human revision | per-transaction revision check and conflict-safe transaction revert |
| GPU retention after resize churn | byte budget, free-texture LRU, render/rate limits |
| Model/dependency supply-chain change | pin model revision/hash, integrity verification, pinned release dependencies and provenance |

Local font names and bytes are private data. Agents should see only the default
font and aliases the user has explicitly approved for the current document;
they must never trigger the Local Font Access permission prompt.

## Audit conclusion

No blocking rewrite is required. The evaluator, node implementations, and
ReactFlow UI can remain in place. The adaptation should extract and harden the
domain mutation/validation boundary, add revisioned render observability, and
then place browser/MCP adapters above it.

# Agent-ready v1 delivery evidence

This is a non-normative progress ledger. Scope and acceptance criteria come
only from `README.md`, `readiness-audit.md`, `architecture.md`, and
`implementation-plan.md` in this directory.

Integration branch: `agent/agent-ready-v1`

| Stage | Status | Evidence |
| --- | --- | --- |
| PR 0 — Freeze the baseline | Complete | Commit [`083f404`](https://github.com/EpocheDrift/a-psychos-gd-tool/commit/083f40480827237e2aa419e70dd8dcda00ec5410) is pushed and tracked in Draft PR [#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2); all local gates pass. |
| PR 1 — Versioned schemas and capability manifest | Complete | Commit [`c42d2be`](https://github.com/EpocheDrift/a-psychos-gd-tool/commit/c42d2be7be53daa1b44188e2b37a393a9237afd5) is pushed and tracked in Draft PR [#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2); all local gates pass. |
| PR 2 — Pure command and transaction service | Complete | Commit [`ccd7227`](https://github.com/EpocheDrift/a-psychos-gd-tool/commit/ccd7227f4a55a9e22972066430890a1b47877800) is pushed and tracked in Draft PR [#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2); all local gates pass. |
| PR 3 — Revisioned render coordinator | Complete | Commit [`ca930fb`](https://github.com/EpocheDrift/a-psychos-gd-tool/commit/ca930fb2380c2ceac1e5a5ab1fc075a9039ad099) is pushed and tracked in Draft PR [#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2); all local gates pass. |
| PR 4 — Preview evidence and stable UI automation | Complete | Commit [`a257449`](https://github.com/EpocheDrift/a-psychos-gd-tool/commit/a257449) is pushed and tracked in Draft PR [#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2); all local gates pass. |
| PR 5 — Gated browser AgentController | Complete | Commit [`a02f74f`](https://github.com/EpocheDrift/a-psychos-gd-tool/commit/a02f74f6f83158d706dda14923147a321c63bcb5) is pushed and tracked in Draft PR [#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2); all local gates pass. |
| PR 6 — Local MCP companion | Complete | Commit [`1a2a833`](https://github.com/EpocheDrift/a-psychos-gd-tool/commit/1a2a8339bd60056797963904291b6dd5c8855dbd) is pushed and tracked in Draft PR [#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2); all local gates pass. |
| PR 7 — Asset and persistence boundary | Not started | Asset/model tools remain disabled. |
| PR 8 — Agent evals and high-level helpers | Not started | Blocked by sequence. |

## PR 0 checklist

- [x] Freeze the current factory document as JSON.
- [x] Add legacy single-graph and layered localStorage fixtures.
- [x] Add a document containing every built-in node type.
- [x] Assert factory counts: 4 layers, 42 nodes, and 38 edges.
- [x] Assert the palette and registry contain the same 31 unique node types.
- [x] Add branch-local Evaluator cycle detection with `CYCLE_DETECTED`.
- [x] Preserve valid concurrent diamond evaluation and retry after a cycle.
- [x] Centralize Chrome/WebGPU launch, storage isolation, errors, and cleanup.
- [x] Add and review a deterministic 256×192 render fixture.
- [x] Make factory, frame, blur, fringe, and interaction smokes use the helper.
- [x] Record commands, prerequisites, fixture update flow, and manual CI gate.
- [x] Run the final typecheck, 119 unit tests, production build, and full browser suite.
- [x] Review the complete diff, including independent architecture, security, and browser audits.
- [x] Commit and push the stage to the fork.
- [x] Open/update the Draft integration PR.

## PR 1 checklist

- [x] Add the strict version 3 project envelope and exportable Draft 2020-12
  schema for documents, layers, graphs, nodes, edges, frame, and asset metadata.
- [x] Add pure migration for the legacy single-graph and layered document
  formats, including `Weight.source = "image"` compatibility normalization.
- [x] Add structural, editable, and renderable validation modes with stable
  codes, RFC 6901 paths, bounded all-errors reporting, and JSON-safe findings.
- [x] Validate registry node/parameter/socket contracts, graph topology,
  parameters, Output cardinality, required inputs, and configurable budgets.
- [x] Project all 31 built-in node types into a JSON-safe capability manifest
  with public descriptions, parameter schemas, execution traits, and truthful
  feature flags.
- [x] Add strict codecs for expressions, binds, identifiers, number lists, and
  approved embedded/bundled PNG, JPEG, and WebP image sources.
- [x] Add atomic internal import/export and preserve version 3 document identity
  and asset metadata through local persistence and undo/redo.
- [x] Preserve editable Output-less drafts while preventing invalid transient
  state or rejected recovery candidates from overwriting the last safe save.
- [x] Commit schema/manifest goldens and migration, validation, persistence, and
  round-trip fixtures with exact drift gates.
- [x] Run the final typecheck, 191 unit tests, production build, and all six
  browser/WebGPU smoke checks; the visual baseline has zero changed pixels.
- [x] Close all P0/P1 findings from independent schema, migration/security, and
  manifest/UI/persistence audits.
- [x] Commit and push the stage to the fork and update the Draft integration PR.

## PR 2 checklist

- [x] Add all 12 atomic document commands with explicit layer targeting,
  transaction-local backward `clientRef`s, durable created-entity identities,
  deterministic layout, and ID tombstones.
- [x] Route Agent and human UI mutations through one copy-on-write command
  switch while preserving untouched layer, graph, node, and edge references.
- [x] Keep the strict Agent API and trusted UI profile runtime-sealed; normalized
  Agent handles are deep-frozen, module-authorized, and fingerprinted once.
- [x] Add revision conflicts, dry runs, precise change summaries, structured
  errors, strict Agent-writable parameter policy, and renderable final-state
  validation.
- [x] Add SHA-256 idempotency, bounded non-evicting replay and transaction
  ledgers, exact before snapshots, and strict head-plus-digest revert.
- [x] Integrate opaque capture/prepare/finalize tokens with Zustand identity CAS
  so Proxy reentrancy, host exceptions, and listener failures cannot create
  ghost commits or lost writes.
- [x] Make human edits, import, undo/redo, Agent apply, and Agent revert advance
  one monotonic runtime revision while selection and font state remain outside
  the document contract.
- [x] Enforce request, command, reference, touched-node, asset, generated-work,
  replay, and ledger budgets without regressing the trusted 20 MiB image path.
- [x] Debounce continuous-edit autosave, preserve the last safe save on quota
  failure, expose `PERSISTENCE_FAILED`, and retry after the next safe edit.
- [x] Add exact 2 MiB−1 boundary, property sequence, hostile Proxy/getter,
  replay, rollback, capacity, structural-sharing, persistence, and UI parity
  regressions.
- [x] Run final typecheck, 266 unit tests, production build, and all six
  browser/WebGPU smoke checks; the visual baseline has zero changed pixels.
- [x] Close all P0/P1 findings from independent contract, security,
  UI/performance, and persistence audits.
- [x] Commit and push the stage to the fork and update the Draft integration PR.

## PR 3 checklist

- [x] Replace component-local render state with a bounded coordinator whose
  immutable revision/attempt tickets expose queued, cooking, complete, failed,
  and superseded states.
- [x] Make `awaitRender` bind to one exact attempt (or the first future attempt),
  with bounded waiters, cancellation, timeout, retry, history, and immutable
  JSON-safe status snapshots.
- [x] Include queue time in the absolute render deadline, coalesce queued work,
  abort stale active work, and prevent a later render from satisfying an older
  waiter.
- [x] Make evaluator cache writes attempt-local and two-phase, reclaim late
  async GPU outputs, preserve diamond memoization, and serialize independent
  DAG branches to bound in-flight browser/GPU resources.
- [x] Keep one persistent evaluator per layer, dispose deleted-layer caches,
  attach stable layer/node/phase errors, and commit caches only after the outer
  render attempt succeeds.
- [x] Preserve a last-known-good double-buffered canvas, publish only the exact
  GPU-complete ticket, and make PNG export lease/read back that exact artifact.
- [x] Treat queue completion and WebGPU error scopes as part of success; surface
  validation, OOM, device-loss, deadline, and resource-limit failures without
  publishing partial work.
- [x] Add reference-counted, byte/count-bounded GPU pooling with free-texture
  LRU eviction, attempt quarantine, invalidation-safe late release, and
  frame-churn tests.
- [x] Bound and recover Trace and Paper.js Boolean workers with FIFO admission,
  exact request/generation matching, byte/request limits, termination on
  cancellation/deadline, and command/point output caps.
- [x] Add attempt-scoped geometry limits, direct deadline checkpoints, bounded
  path sampling, and generated-item preflights across vector, layout, text,
  element, and paint paths.
- [x] Close empty-path amplification with a 250,000 path-container cap and an
  8,192-space → Outline → Duplicator(485) → Flatten regression that retains
  zero paths.
- [x] Bound each opaque Canvas2D paint to 10,000 paths / 25,000 commands and
  bound queued GPU work to 2,048 passes / 32 billion pixel-equivalent work
  before side effects.
- [x] Delay frame-sized Image canvas allocation until decode completes; serialize
  render, presentation, export, cleanup, and device-loss ownership through the same
  GPU lock.
- [x] Keep the development render hook read-only and production-disabled; no MCP
  or public Agent write surface is introduced in this stage.
- [x] Run final typecheck, 354 unit tests across 29 files, production build, and
  all seven browser/WebGPU smoke checks; the visual baseline has zero changed
  pixels and churn ends on the exact r18/a1 ticket.
- [x] Close all P0/P1 findings from independent coordinator, GPU/resource,
  worker/cancellation, and synchronous-geometry audits.
- [x] Commit and push the stage to the fork and update the Draft integration PR.

## PR 4 checklist

- [x] Add strict bounded PNG/WebP preview requests, immutable revision/attempt
  binding at call time, exact current-artifact checks before and after
  encoding, and explicit untrusted-render labeling.
- [x] GPU-downsample before CPU readback, retain/release exact artifacts under
  the shared GPU lock, and reclaim both new and recycled temporary textures on
  success, cancellation, validation failure, and teardown.
- [x] Run metrics and encoding in one terminable FIFO worker with request/byte
  admission limits, absolute deadline/cancellation, generation matching,
  strict MIME/result validation, encoded and RGBA SHA-256, and recovery after
  worker-construction or protocol failure.
- [x] Freeze `preview-metrics-v1`: mean alpha, dominant premultiplied border
  background, non-background bounds, linear-light luminance, and 64-bit DCT
  perceptual hash.
- [x] Publish truthful preview formats, policy, metrics version, and all
  queue/byte/attempt/deadline limits in the capability manifest and golden.
- [x] Give nodes, sockets, parameters, actions, edges, layers, render state,
  errors, frame controls, and the single main preview stable app-owned semantic
  identities and unique accessible names.
- [x] Route pointer wiring and the keyboard/DOM connection inspector through
  the same command/validation layer with persistent structured diagnostics and
  no revision change on missing/type/cycle failures.
- [x] Make numeric parameters real spinbuttons, provide an APG keyboard font
  combobox, make layer selection/rename/visibility/reorder/opacity/deletion
  keyboard-operable, and add app-owned pan/zoom/focus controls.
- [x] Add deterministic collision-aware placement using measured nodes and
  every declared fixed panel, plus a real-browser 20-node overlap gate.
- [x] Add a 50-round semantic browser gate with no coordinates, forced clicks,
  private React Flow selectors, fixed sleeps, hard-coded generated IDs, or raw
  store access; cover exact PNG/WebP evidence, stale capture, negative wiring,
  keyboard parameters/fonts/layers, pan/zoom selector stability, and axe.
- [x] Preserve all existing visual, frame/cache, blur/fringe, marquee,
  revision-churn, export, and real WebGPU smoke checks.
- [x] Run final typecheck, 398 unit tests across 34 files, production build,
  full browser/WebGPU suite, dependency audit, diff check, and independent
  preview/resource, UI/accessibility, and scope/documentation audits.
- [x] Commit and push the stage to the fork and update the Draft integration PR.

## PR 5 checklist

- [x] Add an explicit `--mode agent` static artifact while keeping the default
  production artifact free of Agent globals and making Vite source-development
  Agent mode fail closed.
- [x] Gate the browser bridge on the exact top-level secure loopback page realm
  and fixed origin, with HTTP `Host`/WebSocket `Origin` enforcement explicitly
  deferred to the PR 6 transport.
- [x] Add a short-lived one-shot 256-bit pairing claim, nonce binding,
  fingerprinted client identity, replay/expiry/revoke handling, one-owner
  policy, in-memory secrets, and per-session transaction state destruction.
- [x] Declare all six scopes while allowing only `read`, `preview`, and `edit`
  in PR 5; require browser-trusted selection/approval/revoke controls and
  document that this is not physical-user proof against CDP input.
- [x] Expose only the frozen named `getCapabilities`, `getDocument`,
  `validateDocument`, `applyTransaction`, `getRenderStatus`, `awaitRender`,
  `capturePreview`, and `revertTransaction` methods after pairing.
- [x] Preserve one command/validation layer for UI and Agent writes, enforce
  revision/idempotency/rollback policy, linearize authorization before commit,
  and destroy replay/ledger state on session teardown.
- [x] Project compact capabilities and redacted document snapshots; sanitize
  and bound transaction, validation, render, and controller diagnostics,
  including hostile Proxy traps, data/blob URIs, secret fields, and oversized
  unknown keys.
- [x] Return preview bytes only through a bounded revocable object-URL handle,
  retain exact revision/attempt/hash/metrics evidence, and clear handles on
  revoke, expiry, replacement, or TTL.
- [x] Keep model scope disabled and block preloaded model-backed documents
  before GPU/worker/model execution until the PR 7 integrity gate.
- [x] Add a visible, keyboard-accessible pairing/connected/revoke UI with
  focus restoration, immutable granted scopes, bidi-safe labels, six-scope
  availability disclosure, and no overlap with editor/frame controls.
- [x] Self-host UI fonts; apply restrictive CSP, Referrer-Policy,
  Permissions-Policy, COOP/CORP, no-store, nosniff, and frame denial; preserve
  legacy embedded-image compatibility without granting `fetch(data:)`.
- [x] Remove `__app` and `__render` from all source/artifacts/smokes; migrate
  browser checks to the paired controller and semantic DOM.
- [x] Build and scan poisoned default plus explicit Agent artifacts; in real
  Chrome dynamically import the loaded same-origin JS modules and prove the
  Agent HTML entry exports no Zustand `getState`/`setState` authority.
- [x] Run final typecheck, 443 unit tests across 43 files, both production
  builds, the real-Chrome module/runtime gate, all nine browser/WebGPU smoke
  checks, and the 50-round semantic/accessibility/collision gate.
- [x] Close all P0/P1 findings from independent controller/resource,
  security/scope, UI/accessibility, artifact, and documentation audits.
- [x] Commit and push the stage to the fork and update the Draft integration PR.

## PR 6 checklist

- [x] Add a private workspace package with one executable local MCP companion,
  an exact `127.0.0.1:5199` app host, an isolated Chrome context, and no
  attachment to an existing user profile.
- [x] Expose only six read/preview tools by default and add only
  `apply_transaction` and `revert_transaction` behind both `--allow-edit` and
  explicit in-app `edit` approval.
- [x] Require the exact HTTP `Host`, WebSocket `Origin`, fixed path,
  subprotocol, process-local 256-bit HttpOnly cookie, one owner, pre-auth hello
  deadline, strict sequence numbers, pairing deadline, heartbeat, and terminal
  reconnect semantics.
- [x] Keep browser-trusted approval in the visible page while exposing no MCP
  browser input, CDP, page evaluation, arbitrary navigation, shell, arbitrary
  fetch, general filesystem access, or reflective controller dispatch.
- [x] Add a lexical same-origin browser adapter that dispatches only the eight
  frozen controller operations and uses a separate private controller solely
  for cancellable render wait and preview byte resolution.
- [x] Bound text, binary, preview, stdio input/output, JSON depth/value count,
  pending requests, writes, render waits, previews, request rate, deadlines,
  and cancellation acknowledgement before work can overlap or enter the SDK
  parser.
- [x] Resolve preview handles only inside the page, verify exact byte length,
  SHA-256, MIME, binary magic, header shape, revision, and sequence, and return
  MCP image content without exposing object URLs or logging image bytes.
- [x] Normalize successes, controller faults, local transport failures, unknown
  tools, and SDK pre-handler schema failures into one bounded machine-readable
  `structuredContent.outcome` envelope with request/revision context.
- [x] Make startup, stdin/SIGINT/SIGTERM shutdown, browser disconnect, revoke,
  page loss, protocol failure, pairing failure, and hard deadline teardown
  close Chrome and the loopback host without permitting authority reacquisition
  in the same process.
- [x] Add an AST authority gate over companion source, compiled companion
  JavaScript, and Agent bridge source with exact per-file import capabilities,
  a positive browser-handle use policy, local-module containment, immutable
  trusted bindings, and regression fixtures for indirect/aliased authority.
- [x] Keep asset/model/export/project-replacement tools absent and make
  `Trace`, `OutlineImage`, and `RemoveBackground` machine-readably fail closed
  until the PR 7 integrity boundary lands.
- [x] Run final typecheck, 446 application tests, 41 companion tests, default
  and Agent builds, compiled authority checks, and the poisoned
  default/wrong-origin/raw-store artifact gate.
- [x] Run the real child-process official stdio client through Chrome/WebGPU,
  browser-trusted approval, all eight tool handlers, transaction idempotency,
  structured negative validation, exact preview bytes/hash, conflict-safe
  revert, revoke, and teardown.
- [x] Verify the compiled executable exposes 6/8 and 8/8 tool profiles,
  produces structured unpaired failures, preserves stdout JSON-RPC purity, and
  releases its PID and fixed port on EOF.
- [x] Run all nine browser/WebGPU smokes: zero-delta visual baseline, factory,
  controller, frame, blur, fringe, interaction, exact render churn, and 50/50
  semantic/accessibility/collision workflows.
- [x] Dry-run the package: 26 expected files, complete relative imports,
  packaged Agent artifact, and no source tests, credentials, or unexpected
  files.
- [x] Record the dependency audit without blind remediation: full tree 9
  advisories (1 low, 3 moderate, 5 high), production tree 7 (3 moderate,
  4 high), and zero critical; retain exact MCP SDK and direct runtime versions.
- [x] Close all reproducible P0/P1/P2 findings from independent protocol,
  schema/tool, lifecycle, package/CI, repository, and defensive authority
  audits.
- [x] Commit and push the stage to the fork and update the Draft integration PR.

## Open risks carried beyond PR 6

- The WebGPU suite is a required manual gate until CI has a real, reliable GPU
  runner; ordinary `ubuntu-latest` browser success is not rendering evidence.
- Preview `ArrayBuffer` bytes remain private to the page/companion path and are
  transferred only after exact binary verification. Asset isolation and Agent
  evals have not landed; asset, model, export, project-replacement, arbitrary
  fetch, and filesystem tools remain absent.
- Browser-trusted `Event.isTrusted` rejects page-script synthetic approval but
  does not prove a physical human when an attacker controls CDP/input. The
  companion exposes no CDP, navigation, browser-input, or page-evaluation tool;
  a stronger threat model requires out-of-band native/WebAuthn/OS confirmation.
- The companion enforces the exact loopback host/origin and bounded protocol,
  but the fixed port intentionally fails startup on conflict rather than
  selecting a wider or dynamic origin.
- Browser-native `OffscreenCanvas.convertToBlob` cannot be interrupted from
  inside the call; cancellation terminates and replaces the bounded preview
  worker. DCT pHash is similarity evidence and may vary at floating-point
  boundaries across browser engines; canonical RGBA SHA-256 remains the
  integrity evidence.
- `npm audit` reports 9 full-tree advisories (1 low, 3 moderate, 5 high) and 7
  production-tree advisories (3 moderate, 4 high), with zero critical. The new
  MCP path is a transitive `@hono/node-server` static-serving advisory, while
  this companion imports only the stdio SDK subpaths and its authority gate
  forbids HTTP adapter imports; the remaining high paths are in the existing
  model/native-image toolchain. The suggested SDK downgrade was not applied;
  dependency remediation remains separately reviewable.
- Version 3 currently preserves asset metadata only. PR 7 owns isolated asset
  bytes, content-addressed storage, quotas, and lifecycle management.
- A local working edit that is structurally traversable but semantically invalid
  remains in memory with autosave paused and a visible diagnostic; explicit
  external imports continue to require a renderable project.
- Browser storage read failures currently fall back to the factory project
  without a distinct startup warning, and the page-hide autosave hook has no
  explicit HMR disposal. These are non-blocking persistence hardening items for
  PR 7.
- OpenType shaping/path extraction and `createImageBitmap` remain native calls
  that cannot be forcibly interrupted; current input/glyph/decode boundaries
  limit exposure, while PR 7 owns stricter custom-asset/font isolation.
- Geometry accounting is attempt-cumulative and intentionally conservative, so
  a high-detail Trace → Rasterize chain may exhaust the command budget after
  revisiting otherwise valid geometry. CPU evaluator-cache bytes are not yet a
  separate cross-revision quota.
- Place bind iterations and Random jitter retries rely on bounded outer loops
  but are not charged one-for-one as geometry work. An externally concurrent
  caller could also race one `Evaluator`; the application path is serialized by
  the coordinator.
- Canvas2D native tessellation is capped per call, but extreme self-intersecting
  geometry can still have an uninterruptible tail. Failed GPU attempts destroy
  newly created textures; reused targets rely on every internal path fully
  overwriting them before publication.
- Default and Agent artifacts expose neither `globalThis.__app` nor
  `globalThis.__render`; CI and real-browser artifact gates must continue to
  reject legacy globals and ESM namespace exports carrying raw store authority.

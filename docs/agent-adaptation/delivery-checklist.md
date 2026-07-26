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
| PR 4 — Preview evidence and stable UI automation | Not started | Blocked by sequence. |
| PR 5 — Gated browser AgentController | Not started | Blocked by sequence. |
| PR 6 — Local MCP companion | Not started | No MCP write permission may be exposed before all prerequisite gates pass. |
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

## Open risks carried beyond PR 3

- The WebGPU suite is a required manual gate until CI has a real, reliable GPU
  runner; ordinary `ubuntu-latest` browser success is not rendering evidence.
- Preview evidence, controller authorization, bridge authentication, asset
  isolation, and Agent evals have not landed yet. MCP write tools remain
  unavailable until those gates pass.
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
- `globalThis.__app` is a development-only smoke hook, not a public Agent API;
  production builds do not expose it and PR 5 must not expand it into raw store
  access.

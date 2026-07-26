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
| PR 3 — Revisioned render coordinator | Not started | Blocked by sequence. |
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

## Open risks carried beyond PR 2

- The WebGPU suite is a required manual gate until CI has a real, reliable GPU
  runner; ordinary `ubuntu-latest` browser success is not rendering evidence.
- Render coordination, controller authorization, bridge authentication, asset
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
- When one evaluator dependency rejects, already-started sibling work can
  continue briefly. PR 3 owns revision cancellation and stale-work handling.
- `globalThis.__app` is a development-only smoke hook, not a public Agent API;
  production builds do not expose it and PR 5 must not expand it into raw store
  access.

# Agent-ready v1 delivery evidence

This is a non-normative progress ledger. Scope and acceptance criteria come
only from `README.md`, `readiness-audit.md`, `architecture.md`, and
`implementation-plan.md` in this directory.

Integration branch: `agent/agent-ready-v1`

| Stage | Status | Evidence |
| --- | --- | --- |
| PR 0 — Freeze the baseline | Ready to publish | Saved-document fixtures, registry inventory tests, cycle guard, shared WebGPU smoke launcher, and reviewed small-frame PNG pass all local gates. Commit/push and Draft PR pending. |
| PR 1 — Versioned schemas and capability manifest | Not started | Must begin only after PR 0 is committed and pushed. |
| PR 2 — Pure command and transaction service | Not started | Blocked by sequence. |
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
- [ ] Commit and push the stage to the fork.
- [ ] Open/update the Draft integration PR.

## Open risks carried beyond PR 0

- The WebGPU suite is a required manual gate until CI has a real, reliable GPU
  runner; ordinary `ubuntu-latest` browser success is not rendering evidence.
- Versioned deep validation, atomic transactions, render coordination,
  controller authorization, bridge authentication, and asset isolation have
  not landed yet. MCP write tools remain unavailable until those gates pass.
- When one evaluator dependency rejects, already-started sibling work can
  continue briefly. PR 3 owns revision cancellation and stale-work handling.
- `globalThis.__app` is a development-only smoke hook, not a public Agent API;
  production builds do not expose it and PR 5 must not expand it into raw store
  access.

# AI Agent Adaptation

Status: **implementation in progress** — these documents define the target and
rollout gates; phase-by-phase implementation evidence lives in
[`delivery-checklist.md`](./delivery-checklist.md).

## Executive summary

`a-psychos-gd-tool` now has a versioned command/validation layer, exact
revision/render/preview evidence, a paired narrow browser controller, and an
authenticated local stdio MCP companion in an explicit loopback-only static
Agent artifact. The default artifact exposes no Agent global, and neither
artifact exposes the raw Zustand store. The isolated asset/persistence boundary
and broader Agent evals remain staged work.

The codebase is unusually well-positioned for adaptation:

- the saved document is JSON-safe;
- node definitions already describe sockets, parameter kinds, defaults, and
  ranges;
- graph connection rules already enforce type compatibility and acyclicity;
- document edits already flow through a small set of store actions;
- rendering already emits cache events and user-visible errors;
- Puppeteer smoke tests already exercise the app through a real WebGPU browser.

The recommended path is to make the existing domain model a supported tool
surface, rather than teaching an agent to drag small sockets by screen
coordinates.

## Target outcome

An external agent should be able to:

1. discover every supported node and parameter;
2. inspect a compact, revisioned document snapshot;
3. apply an atomic, validated batch of graph edits;
4. wait for the exact document revision to finish rendering;
5. inspect structured cook errors and a visual preview;
6. retry safely without duplicating mutations;
7. conflict-safely revert its own transaction;
8. operate through either a browser bridge or a local MCP server without direct
   access to the raw Zustand store.

## Proposed maturity model

| Level | Capability | Project status |
| --- | --- | --- |
| L0 | Screenshot-only GUI control | Available, but brittle |
| L1 | Internal automation/test hook | Replaced by semantic UI + paired controller tests |
| L2 | Stable, validated command/query API | Implemented |
| L3 | External tool adapter (MCP/browser bridge) | Implemented with human-approved read/preview and opt-in edit profiles |
| L4 | Closed-loop visual planning and verification | Proposed after L3 |

The first delivery target is **L3**, with enough preview and render feedback to
support a constrained L4 loop.

## Key architecture decisions

1. **One domain API, multiple adapters.** UI, browser bridge, tests, and MCP
   should share the same command/query layer.
2. **Explicit layer IDs.** Agent commands must not depend on whichever layer or
   node the human UI currently has selected.
3. **Atomic transactions.** A multi-node edit produces one revision and one undo
   entry, or changes nothing.
4. **Optimistic concurrency and idempotency.** Every write carries
   `expectedRevision` and `requestId`.
5. **Structured failures.** Invalid commands return machine-readable error
   codes and paths; they do not silently no-op.
6. **Render by revision.** A successful mutation is distinct from a successful
   GPU render. Agents can wait for or inspect the requested revision.
7. **Capability-derived schemas.** Public node schemas are generated from the
   existing registry, extended with descriptions and constraints where needed.
8. **No raw store exposure.** Default and Agent artifacts expose neither
   `__app` nor `__render`; a production artifact gate also checks that the ESM
   namespace cannot yield Zustand `getState`/`setState`.
9. **Local-first bridge.** The first MCP implementation binds to loopback,
   authenticates each browser session, and does not require a hosted control
   plane.
10. **Preview is evidence, not state.** The JSON document is authoritative;
    screenshots and image metrics verify the render.

## Documents

- [Readiness audit](./readiness-audit.md) — current evidence, gaps, risks, and
  threat model.
- [Target architecture](./architecture.md) — components, command/query
  contracts, MCP/browser transport, render lifecycle, and error model.
- [Implementation plan](./implementation-plan.md) — staged PRs, acceptance
  criteria, test matrix, and rollout gates.
- [Delivery evidence](./delivery-checklist.md) — non-normative phase status and
  reproducible verification links.

## Non-goals for the first release

- natural-language generation inside the application;
- a cloud-hosted multi-tenant agent service;
- arbitrary JavaScript execution in document expressions;
- pixel-perfect autonomous art direction;
- replacing the existing human node editor;
- exposing internal GPU textures or Zustand implementation details as a public
  protocol.

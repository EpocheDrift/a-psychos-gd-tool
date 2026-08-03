# AI Agent Adaptation

Status: **Agent-ready v1 implementation complete through PR 8,
owner-approved, and merged manually through
[#2](https://github.com/EpocheDrift/a-psychos-gd-tool/pull/2) on
2026-07-27**. Before merge, the owner waived an additional full capability
sweep and a current-head remote CI record as approval prerequisites. This is
not a claim that those checks ran, and the merge does not approve production
release or commercial RMBG-1.4 use. Phase-by-phase implementation evidence and
the remaining disclosed risks live in
[`delivery-checklist.md`](./delivery-checklist.md).

## Executive summary

`a-psychos-gd-tool` now has a versioned command/validation layer, exact
revision/render/preview evidence, a paired narrow browser controller, and an
authenticated local stdio MCP companion in an explicit loopback-only static
Agent artifact. The default artifact exposes no Agent global, and neither
artifact exposes the raw Zustand store. The isolated content-addressed asset
boundary, portable project save/load, and human-approved pinned RMBG-1.4 model
path are implemented. The seven-scenario Agent evaluation suite is the
final delivered stage: it runs through the real MCP/stdio/WebSocket/browser
path, verifies three creative workflows and four recovery workflows, and emits
reviewed visual evidence plus redacted metrics.

The codebase is unusually well-positioned for adaptation:

- the saved document is JSON-safe;
- node definitions already describe sockets, parameter kinds, defaults, and
  ranges;
- graph connection rules already enforce type compatibility and acyclicity;
- document edits already flow through a small set of store actions;
- rendering already emits cache events and user-visible errors;
- Puppeteer smoke tests already exercise the app through a real WebGPU browser.

The implementation makes the existing domain model the supported tool surface,
so an agent does not need to drag small sockets by screen coordinates.

## Delivered v1 outcome

An external agent can:

1. discover every supported node and parameter;
2. inspect a compact, revisioned document snapshot;
3. apply an atomic, validated batch of graph edits;
4. wait for the exact document revision to finish rendering;
5. inspect structured cook errors and a visual preview;
6. retry safely without duplicating mutations;
7. conflict-safely revert its own transaction;
8. operate through either a browser bridge or a local MCP server without direct
   access to the raw Zustand store.

## Delivered maturity model

| Level | Capability | Project status |
| --- | --- | --- |
| L0 | Screenshot-only GUI control | Available, but brittle |
| L1 | Internal automation/test hook | Replaced by semantic UI + paired controller tests |
| L2 | Stable, validated command/query API | Implemented |
| L3 | External tool adapter (MCP/browser bridge) | Implemented with human-approved read/preview plus independent edit/assets/model profiles |
| L4 | Closed-loop visual planning and verification | Implemented for the bounded PR 8 workflow suite |

Agent-ready v1 delivers **L3** plus the tested, constrained **L4** loop. Broader
autonomous art direction remains outside the first-release scope.

## Try it

- [Getting started: Web UI and Agent MCP](../getting-started.md)
- [中文入门：Web UI 与 Agent MCP](../getting-started.zh-CN.md)
- [Local MCP companion reference](../../packages/mcp-companion/README.md)

The walkthroughs are the user-facing entry point. The documents below are the
architecture, security, implementation, and review record.

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

- [Agent × MCP 平面设计审美实验规约](../agent-aesthetic-experiments/SPEC.zh-CN.md)
  — 在工程闭环之外，规范持续的人机 Brief、艺术指导、视觉质量和协作效率实验。
- [Agent × MCP 审美协作 Playbook](../agent-aesthetic-experiments/PLAYBOOK.zh-CN.md)
  — 从当前实验提炼的操作性工作流、质量闸门、anti-template 规则和未来 Skill 晋升
  条件；当前仍受两项目、单评价者和小样本证据限制。
- [`collaborate-on-graphic-design` v0.1-alpha](../../skills/collaborate-on-graphic-design/SKILL.md)
  — 把当前 working rules 封装成可安装、可 forward-test 的审美协作 Skill；它不宣称
  已验证稳定或保证“好看”。
- [v0.1-alpha operator/evaluator suite](../../evals/collaborate-on-graphic-design/v0.1-alpha/SUITE.md)
  — 与 runner context 隔离的 retrospective、forward、failure-honesty gates、公开合成素材
  和报告入口；当前明确缺少晋升所需的正式 recovery regression。
- [真实审美实验的 MCP 交互反馈](../agent-aesthetic-experiments/MCP-UX-FEEDBACK.zh-CN.md)
  — 基于首个实测 Session 的边界测量、会话连续性、字体授权和人类反馈桥建议。
- [中文审批简报](./approval-brief.zh-CN.md) — 所有者的最终批准、明确豁免的
  额外验收项、风险分层和不在批准范围内的事项。
- [Readiness audit](./readiness-audit.md) — original baseline gap analysis and
  the enduring threat model.
- [Target architecture](./architecture.md) — components, command/query
  contracts, MCP/browser transport, render lifecycle, and error model.
- [Implementation plan](./implementation-plan.md) — staged PRs, acceptance
  criteria, test matrix, and rollout gates.
- [Agent evaluation suite](./evaluation-suite.md) — seven real MCP scenarios,
  golden/preview policy, recovery traces, metrics, and helper decisions.
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

# AI Agent Adaptation

Status: **experimental, pre-release**

This project includes an optional local MCP companion that lets a tool-using
Agent work on the same graphic-design document as the human Web UI. The Agent
uses the application's versioned document and render contracts rather than
screen coordinates or direct access to the Zustand store.

## What is available

- registry-derived node and parameter discovery;
- compact, revisioned document inspection;
- atomic, validated, idempotent graph transactions;
- optimistic conflict detection and conflict-safe transaction revert;
- exact revision/render/preview evidence and rendered-node measurements;
- bounded content-addressed image ingestion;
- a pinned, integrity-checked local RMBG-1.4 model path;
- an authenticated loopback-only stdio MCP companion;
- a visible, resizable Human + Agent workbench in an isolated Chrome context.

The current MCP session scopes are `read`, `preview`, `edit`, `assets`, and
`model`. Portable project save/load and full-resolution export remain explicit
human UI actions.

## Start here

- [Codex Quick Start](../codex-quickstart.md)
- [Codex 中文快速入门](../codex-quickstart.zh-CN.md)
- [Host-neutral Web UI and Agent MCP guide](../getting-started.md)
- [通用 Web UI 与 Agent MCP 中文入门](../getting-started.zh-CN.md)
- [MCP companion reference](../../packages/mcp-companion/README.md)

## Technical references

- [Current Agent control architecture](./architecture.md)
- [Executable Agent evaluation suite](./evaluation-suite.md)
- [Browser and WebGPU smoke tests](../testing/browser-smoke.md)
- [Security policy](../../SECURITY.md)
- [Aesthetic-collaboration research summary](../agent-aesthetic-experiments/README.md)
- [`collaborate-on-graphic-design` alpha Skill](../../.agents/skills/collaborate-on-graphic-design/SKILL.md)

## Security boundary

The companion binds to loopback, authenticates its browser session, validates
Host and Origin, enforces explicit scopes and resource budgets, and exposes
only named design operations. It does not provide generic shell, filesystem,
URL fetch, browser navigation, CDP input, page evaluation, or project
replacement tools.

An Agent host such as Codex or Claude Code may independently have permissions
granted by its own runtime. Connecting this MCP neither grants nor revokes
those host-level permissions.

The default Web build exposes no Agent controller. The Agent-enabled build is
served by the local companion on its fixed loopback origin. Interactive mode
uses browser-trusted scope approval; the explicit Trusted Local profile treats
starting that local process as authorization for its versioned scope set.
Neither mode is a claim that `Event.isTrusted` proves a physical human against
an attacker that already controls browser input.

## Evidence and limits

`npm run check:agent-evals` exercises three creative workflows and four
recovery paths through the real MCP, stdio, WebSocket, browser, and WebGPU
chain. Passing those checks demonstrates bounded execution and evidence
integrity; it does not prove general aesthetic quality.

The project remains pre-release. CI is not a substitute for testing every
browser and hardware GPU. RMBG-1.4 commercial use requires separate licensing
review, and the current aesthetic-collaboration Skill remains alpha.

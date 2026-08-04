# Documentation

English · [简体中文](README.zh-CN.md)

This index separates user instructions, Agent setup, engineering reference, and
experimental evidence. Start with the row that matches what you are doing; the
longer architecture and evaluation records are not required for ordinary use.

## Choose a path

| Goal | Start here | What it covers |
| --- | --- | --- |
| Make a poster yourself | [Getting Started](getting-started.md) | Clone, 5173 Web UI, first node graph, save/load, export, and troubleshooting |
| Look up a node | [Node reference](node-reference.md) | All 31 public node types, wire types, and concise purposes |
| Use Codex for design | [Codex Quick Start](codex-quickstart.md) | Repo-local Skill, exact MCP registration, 5199 preflight, first design prompt, update, and removal |
| Use another MCP host | [Agent section of Getting Started](getting-started.md#connect-an-agent-in-about-10-minutes) | Host-neutral launch, scopes, interactive approval, and troubleshooting |
| Operate or review the Companion | [Local MCP Companion reference](../packages/mcp-companion/README.md) | Tools, profiles, lifecycle, authentication, health, and verification |
| Understand current constraints | [Known Limitations](known-limitations.md) | Alpha status, platform coverage, 5199 behavior, output limits, and evidence boundaries |
| Review Agent architecture | [Agent adaptation overview](agent-adaptation/README.md) | Domain API, transactions, revision/render evidence, transport, and security decisions |
| Contribute code | [Contributing](../CONTRIBUTING.md) | Local checks, focused PRs, browser/MCP expectations, and security reporting |
| Run browser verification | [Browser and WebGPU smoke tests](testing/browser-smoke.md) | Chrome prerequisites, individual suites, environment variables, and artifacts |
| Prepare a release | [Release process](releasing.md) | Version PR, required evidence, tag, GitHub Release, and rollback |
| Review dependency risk | [Dependency security baseline](dependency-security.md) | Current reviewed exceptions, reachability, mitigations, and expiry |
| Review product direction | [Public Alpha roadmap](roadmap.md) | Current baseline, deferred decisions, and the lifecycle of product, upstream, research, and release lanes |

## The workspace rule

The port is part of the product boundary, not a preference:

- **Human-only session:** run `npm run dev` and use the Vite URL, normally
  `http://localhost:5173`.
- **Any session involving an Agent:** let the MCP host start the Companion and
  use its visible Chrome at `http://127.0.0.1:5199` as the only workbench.

The two pages do not share a document or Agent bridge. Manually visiting 5199
from a normal browser returns `401 Unauthorized` because only the isolated
Companion-launched Chrome context receives the temporary authentication cookie.

## Which document is authoritative?

- For current runtime behavior, use the checked-out code, generated capability
  manifest, and the [Companion reference](../packages/mcp-companion/README.md).
- For installation and operation, use the two quick starts above.
- For security support and private reports, use [SECURITY.md](../SECURITY.md).
- Architecture and sanitized experiment records explain decisions and evidence;
  they do not override the live capability contract.

## Alpha collaboration Skill

The repository-local
[`collaborate-on-graphic-design`](../.agents/skills/collaborate-on-graphic-design/SKILL.md)
Skill helps translate briefs, compare art directions, execute through MCP, and
structure critique. It is `v0.1-alpha`: useful as a working method, but not a
guarantee of aesthetic quality or cross-user/model stability. Its evaluator
suite is engineering/research material rather than a new-user tutorial.

## Project policy

- [Known limitations](known-limitations.md)
- [Public Alpha roadmap](roadmap.md)
- [Security policy](../SECURITY.md)
- [Contributing](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)
- [License](../LICENSE)
- [Attribution and third-party notices](../NOTICE.md)

# a-psychos-gd-tool — Agent-enabled downstream

English · [简体中文](README.zh-CN.md)

This repository is an Agent-enabled downstream of
[Blake Shao's original `a-psychos-gd-tool`](https://github.com/blakeshao/a-psychos-gd-tool):
a node-based graphic-design workbench that renders in the browser with WebGPU.
It keeps the human node editor and adds portable projects, a local MCP
companion, exact revision/render evidence, and an alpha graphic-design
collaboration Skill.

> **Pre-release alpha.** Install from source; APIs and project compatibility may
> still change. This downstream currently has no hosted deployment. The
> [original upstream demo](https://a-psychos-gd-tool.vercel.app/) is useful for
> exploring the upstream human UI, but it does **not** include this fork's
> Agent/MCP features.

## Choose your workspace

There are two deliberate ways to run the project. Do not mix them in one
design session.

| Session | Start it with | Workspace |
| --- | --- | --- |
| Human only | `npm run dev` | The URL printed by Vite, normally `http://localhost:5173` |
| Human + Agent | Let an MCP host start the Companion | The visible Companion Chrome at `http://127.0.0.1:5199` |

If an Agent participates, **5199 is the only workbench for that session**. The
human and Agent edit the same in-memory document there. The 5173 development UI
is a different build and is not connected to MCP.

The Companion launches an isolated, visible Chrome context. Manually opening
`http://127.0.0.1:5199` in a normal browser returns `401 Unauthorized`: only the
Companion-launched context receives the temporary authentication cookie. This
is intentional, not a missing login page.

## Requirements

- Node.js 22.12 or newer and Git
- A WebGPU browser for the human UI: Chrome/Edge 113+ or Safari 18+
- A WebGPU-capable Chrome/Chromium installation for Agent sessions
- An MCP host such as Codex or Claude Code for Agent sessions

The documented setup and CI reference paths are macOS and Linux. The setup
script requires a POSIX shell. Windows users can use Git Bash or WSL; the Codex
guide also includes the PowerShell MCP-registration command. Treat Windows
end-to-end behavior as best-effort until it has dedicated CI coverage.

## Human-only quick start

```sh
git clone https://github.com/EpocheDrift/a-psychos-gd-tool.git
cd a-psychos-gd-tool
./scripts/setup.sh
npm run dev
```

Open the printed URL. A blank project starts with one layer and one `Output`
node; choose the bundled example from **start from…** if you want to inspect a
finished graph. Follow the [10-minute poster guide](docs/getting-started.md) for
node wiring, save/load, export, and canvas controls.

## Agent quick start

Build the explicit Agent artifact and local stdio Companion:

```sh
./scripts/setup.sh
npm run build:agent
npm run build:mcp
```

Codex users should continue with the
[Codex Quick Start](docs/codex-quickstart.md). It provides the exact registration
command, verifies both the repository-local Skill and MCP tools, and starts the
shared 5199 workbench. Claude Code and other MCP hosts can follow the
[host-neutral walkthrough](docs/getting-started.md#connect-an-agent-in-about-10-minutes).

The personal-workspace path uses the versioned `full-design-v1` profile with
`--trusted-local`. Starting that explicitly configured local process authorizes
its current `read`, `preview`, `edit`, `assets`, and `model` design scopes. The
first RMBG-1.4 download still requires a separate human license confirmation.

## What is included

- [31 typed node kinds](docs/node-reference.md) for text, vector, raster,
  layout, placement, composition, and output
- WebGPU rendering, per-layer graphs, blend modes, frame-aware caching, and
  undo/redo
- Content-addressed image assets, portable `.gfxproject.json` save/load, and
  exact PNG export
- A revision-checked, atomic and idempotent Agent command layer
- A loopback-only MCP Companion with exact render/preview evidence and a shared
  responsive 5199 workbench
- A repository-local
  [`collaborate-on-graphic-design`](.agents/skills/collaborate-on-graphic-design/SKILL.md)
  Skill, explicitly marked `v0.1-alpha`
- Unit, authority, browser/WebGPU, accessibility, MCP lifecycle, and Agent E2E
  checks

The Skill is a collaboration method, not a promise of universally good taste.
See [known limitations](docs/known-limitations.md) before relying on the project
for production work.

## Security boundary

The Graphic Design MCP exposes named `gfx_*` operations, not a general computer
control surface. It does not grant shell access, arbitrary filesystem access,
arbitrary URL fetching, browser navigation, CDP input, or page evaluation.
Project replacement and portable save/load remain explicit human UI actions.

An MCP host may separately have shell, workspace, or network permissions that
the user granted to that host. This project neither grants nor revokes those
host-level permissions. The Companion stays loopback-only, authenticated, and
scope-gated. See the [MCP reference](packages/mcp-companion/README.md) and
[security policy](SECURITY.md).

## Documentation

Use the [documentation index](docs/README.md) to choose the shortest path for:

- human Web UI use;
- Codex or another MCP host;
- Agent architecture and security review;
- contribution, testing, and release work;
- the alpha collaboration Skill and its evidence limits.

## Quality checks

```sh
npm run typecheck              # app + Companion TypeScript
npm test                       # unit, authority, and Skill gates; no GPU needed
npm run build                  # human app, Agent app, and MCP Companion
npm run check:agent-build      # Agent/default artifact security boundary
npm run check:mcp              # real stdio → Companion → Chrome/WebGPU round-trip
```

Browser and MCP checks require a working Chrome/WebGPU environment. The
[browser smoke guide](docs/testing/browser-smoke.md) lists the narrower commands
and artifact policy.

## Contributing, license, and provenance

Issues and focused PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before opening a change and use [private vulnerability reporting](SECURITY.md)
for security issues.

The code is distributed under the [MIT License](LICENSE). The original project
was created by Blake Shao; this downstream and its relationship to the upstream
demo are described in [NOTICE.md](NOTICE.md). Bundled JetBrains Mono files use
the [SIL Open Font License 1.1](public/fonts/OFL.txt). Optional downloaded model
artifacts have their own terms and are not relicensed by this repository.

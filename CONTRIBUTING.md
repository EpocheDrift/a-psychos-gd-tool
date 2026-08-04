# Contributing

English · [简体中文](CONTRIBUTING.zh-CN.md)

## Local setup

Use Node.js 22.12 or newer. Node 22 is the CI reference environment.

```sh
./scripts/setup.sh
npm run typecheck
npm test
```

The setup script installs the exact lockfile with `npm ci` and verifies the
bundled font; it does not download mutable build inputs.

## Pull requests

Create a focused branch and keep unrelated changes out of the pull request.
Open a bug or feature issue first when the behavior, compatibility boundary, or
design is not already agreed. Small documentation and test fixes can go
straight to a pull request.

Use this matrix before opening the pull request:

| Change | Minimum local evidence |
| --- | --- |
| Documentation or metadata | `npm run check:versions` and verify changed links |
| TypeScript or UI behavior | `npm run typecheck` and `npm test` |
| Agent build or controller | `npm run check:agent-artifacts` |
| MCP protocol or companion | `npm run check:mcp` |
| Rendering or browser interaction | Relevant checks from the browser smoke guide |

The common baseline is:

```sh
npm run typecheck
npm test
npm run check:agent-artifacts
```

Rendering, browser, or MCP changes also require the checks described in
[the browser smoke guide](docs/testing/browser-smoke.md).

If an Agent participates in a design workflow, begin from the shared
`http://127.0.0.1:5199` workbench. Human and Agent use that same 5199
workbench for the session.

CI must pass before merge. Security reports belong in the private channel
described by [SECURITY.md](SECURITY.md), not in a public issue.

## Fork and upstream policy

This repository is an Agent-enabled downstream distribution. Changes that
depend on its MCP, persistence, or Agent contracts should target this
repository's `main`. A generally useful fix intended for Blake Shao's original
project should be isolated from downstream-only code and proposed against
[`blakeshao/a-psychos-gd-tool`](https://github.com/blakeshao/a-psychos-gd-tool)
from a branch based on that upstream's current `main`. Do not ask upstream to
review the full downstream history.

When an upstream contribution is ready to implement, use an on-demand branch
based directly on the current upstream branch:

```sh
git fetch upstream main
git switch -c upstream-contrib/topic-name upstream/main
```

Target the resulting pull request at the original repository's `main`. Do not
merge that branch back into this fork merely to preserve it; bring any relevant
downstream change into `origin/main` through its own product PR.

Use `research/<topic>` only for a bounded active experiment. Raw prompts, assets,
and repetitive session evidence stay outside `main`; a stable result is promoted
with a focused, tested product PR. Snapshot and release tags are immutable. These
branch prefixes are created on demand, so the repository does not keep empty
placeholder branches. See the [Public Alpha roadmap](docs/roadmap.md) for the
current decision gates.

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](LICENSE).

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
Before opening it, run the checks relevant to the changed area:

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

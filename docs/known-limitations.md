# Known limitations

English · [简体中文](known-limitations.zh-CN.md)

This is a source-installed, local-first alpha. The limitations below define the
current product boundary; they are not hidden roadmap promises.

## Release and support status

- [GitHub Releases](https://github.com/EpocheDrift/a-psychos-gd-tool/releases)
  is the source of truth for published versions. A green `main`, archival
  snapshot tag, or upstream deployment is not a release of this fork. There is
  currently no hosted build of this downstream.
- Package versions remain pre-release; throughout alpha, public APIs, MCP
  contracts, project migration policy, and setup may change between versions.
- Security fixes target the latest `main`. Older commits and snapshots do not
  receive separate support, and there is no response-time SLA.
- The original upstream demo does not contain this fork's persistence,
  Agent/MCP, shared-5199, or collaboration-Skill additions.

## Platform coverage

- Node.js 22.12+ is required.
- The human UI needs WebGPU. Chrome/Edge 113+ and Safari 18+ are documented,
  but browser/GPU/driver combinations can still produce different rendering or
  availability behavior.
- Agent sessions require Chrome/Chromium; Safari can run the human UI but cannot
  be the Companion browser.
- The primary setup and CI paths cover POSIX shells, Ubuntu, and macOS. Windows
  users can use Git Bash or WSL and have a PowerShell Codex-registration example,
  but there is no dedicated Windows end-to-end CI job yet.

## 5173 and 5199 are different products surfaces

- `npm run dev` normally serves the human source-development UI on 5173. It has
  no Agent bridge.
- The local MCP Companion owns the fixed `127.0.0.1:5199` origin and launches
  the authenticated Agent artifact in an isolated Chrome context. It cannot
  attach to an already-running 5173 page.
- Only one Companion can own 5199. A port conflict is a startup error; there is
  no automatic fallback to a different origin.
- A normal browser manually visiting 5199 receives `401 Unauthorized`. There is
  currently no “open in my everyday browser” pairing flow.
- The Companion browser uses a temporary profile/context and does not inherit
  personal cookies, extensions, or site storage. Save a portable project before
  closing the Companion if the work must survive another session.

## Agent and MCP scope

- The MCP Companion is a local stdio process installed from this source tree;
  there is no hosted MCP endpoint or cloud multi-user service.
- The Companion offers allowlisted design operations, not shell, arbitrary
  filesystem, arbitrary URL, browser navigation, CDP input, or page-evaluation
  tools. The MCP host may independently have permissions the user granted it.
- Project replacement and portable project save/load remain human UI actions.
  An Agent can modify the current document through validated transactions but
  cannot silently replace the whole project through this MCP.
- `full-design-v1` is a fixed snapshot of current scopes; future scopes are not
  added automatically. Trusted Local removes repeated pairing for that explicit
  profile, not every human decision.
- The first RMBG-1.4 model download still requires a separate human license
  review. Optional model artifacts have their own terms and are not covered by
  this repository's MIT license.
- The graphic-design collaboration Skill is `v0.1-alpha`. Existing experiments
  are limited process evidence, not proof of consistent taste, autonomy, or
  production-quality design across users, models, fonts, and media.

## Document and output limits

- Browser working storage is not a portable backup. Use **save project** to
  download `.gfxproject.json`, especially before closing a 5199 session.
- Newer unknown schema fields, node types, or parameters fail closed. A project
  saved by a newer build is not guaranteed to load in an older build.
- The human export path currently produces PNG. Editable Illustrator/SVG export
  is not implemented.
- There is no dedicated crop node yet, and the available text, vector, raster,
  layout, and element operations remain a finite 31-node palette.
- Exact revision/render evidence proves which document state produced a preview;
  clipping measurements prove frame intersection only. Neither proves visual
  quality, optical balance, accessibility of the artwork, or fitness for a
  publishing context.

## Local-first is not offline-only

- Initial setup uses `npm ci` and therefore downloads locked dependencies from
  the configured npm registry.
- Optional RMBG-1.4 preparation downloads only the pinned, integrity-checked
  model artifacts after human confirmation.
- The Companion itself binds to loopback and does not require a hosted control
  plane, but an MCP host may use its own network capabilities under its own
  permission model.

For setup and operation, return to the [documentation index](README.md). Report
security issues through [private vulnerability reporting](../SECURITY.md).

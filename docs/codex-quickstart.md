# Codex Quick Start

English · [简体中文](codex-quickstart.zh-CN.md)

Use this path when you want Codex to help interpret a graphic-design brief and
then build, measure, preview, and refine the result in the shared visual
workbench. The repository supplies two separate pieces:

| Piece | What it does | Setup |
| --- | --- | --- |
| `collaborate-on-graphic-design` Skill | Brief translation, art directions, critique, and quality gates | None inside this repository; Codex discovers it from `.agents/skills/collaborate-on-graphic-design` |
| Graphic Design MCP | Document reads/writes, exact render evidence, assets, and the visible 5199 workbench | Build it and register it once with Codex |

The Skill can still help with art direction when MCP is unavailable, but it
must not claim that it changed or measured a document. MCP provides reliable
execution primitives; it does not by itself supply the aesthetic collaboration
method. Use both for the complete workflow.

## 1. Clone and build

You need Node.js 22.12 or newer, Git, Codex, and a WebGPU-capable
Chrome/Chromium installation.

```sh
git clone https://github.com/EpocheDrift/a-psychos-gd-tool.git
cd a-psychos-gd-tool
./scripts/setup.sh
npm run build:agent
npm run build:mcp
```

`setup.sh` validates Node and the bundled font, then installs the exact
lockfile. The two build commands create the browser artifact and local stdio
MCP entry point. Re-running all three commands is safe.

## 2. Open this repository in Codex

Make the cloned repository, or any directory below it, the Codex workspace.
Start a new task after cloning. Codex discovers the repository-local Skill from
`.agents/skills/collaborate-on-graphic-design`; there is no separate Skill
install command and no copy is made into your home directory.

To invoke it explicitly, include `$collaborate-on-graphic-design` in the
prompt. In the CLI or IDE extension, `/skills` should list it; in the desktop
app, open **Skills** in the sidebar. Codex normally detects Skill changes
automatically. If the Skill is missing or stale, confirm that the task is
rooted inside this repository and that the Skill file exists, then restart
Codex.

## 3. Register the MCP companion

The command below is for a POSIX shell on macOS/Linux. It writes a user-level
Codex MCP entry whose Node and clone paths are intentionally absolute. From the
repository root, run:

```sh
codex mcp add graphic-design -- \
  "$(command -v node)" \
  "$PWD/packages/mcp-companion/dist/index.js" \
  --profile=full-design-v1 \
  --trusted-local
```

From PowerShell on Windows, run this equivalent from the repository root:

```powershell
$gdNodePath = (Get-Command node).Source
$gdRepoPath = (Get-Location).Path
$gdEntryPath = Join-Path $gdRepoPath 'packages/mcp-companion/dist/index.js'
codex mcp add graphic-design -- $gdNodePath $gdEntryPath --profile=full-design-v1 --trusted-local
```

The shell expands both executable and repository paths before Codex saves the
configuration. This avoids Desktop/NVM `PATH` differences and lets Codex launch
the stdio process itself. Do not also run `npm run mcp:start` during the same
session.

Registration is explicit because this local stdio server has machine-specific
paths. The Skill metadata intentionally does not invent a portable MCP URL or
silently modify the user's Codex configuration.

`full-design-v1` grants the current `read`, `preview`, `edit`, `assets`, and
`model` design scopes. `--trusted-local` treats intentionally starting this
loopback-only process as approval. Use it only for a personal clone you trust.
For interactive least-authority setup, omit those two arguments and follow the
[permission walkthrough](getting-started.md#3-start-read-only).

## 4. Verify and start a design task

Reload or restart any Codex client that was already open, then confirm that
Codex saved the server:

```sh
codex mcp list
codex mcp get graphic-design --json
```

The list should contain `graphic-design`; the JSON should show the absolute Node
and `dist/index.js` paths plus both profile arguments. In the Codex TUI, `/mcp`
should show the active server; the desktop app and IDE extension expose the
same status in their MCP server settings. Start a new Codex task rooted in the
repository and run this no-write preflight first:

```text
Use $collaborate-on-graphic-design. Before designing or changing anything,
call gfx_get_capabilities and gfx_get_document through the Graphic Design MCP.
Tell me the current frame, revision, layers, and available design scopes, then
stop.
```

This checks real Skill resolution and real `gfx_*` tool access rather than only
the saved configuration. Then begin the design conversation with:

```text
Use $collaborate-on-graphic-design.

I want to design [artifact] for [audience and context]. It should feel [more
like this] and not [like that]. The required copy/assets are [...].

First, read the intent back as visual relationships and propose two genuinely
different directions. Wait for my choice. Then inspect the live document and
capabilities through the Graphic Design MCP, execute the chosen direction,
check accidental clipping, show exact preview evidence, and ask for focused
aesthetic feedback.
```

When Codex launches the companion, a Chrome window opens at
`http://127.0.0.1:5199`. Keep it visible: it is the shared human-and-Agent
workbench, not a status page. The separate `npm run dev` UI normally runs on
5173 and is only for source-development work; it is not connected to MCP.

The first RMBG-1.4 model download still requires a separate human license
confirmation in the 5199 window. Trusted Local does not bypass that decision.

## 5. Update or move the clone

To update the repository:

```sh
git pull --ff-only
./scripts/setup.sh
npm run build:agent
npm run build:mcp
```

The repo-local Skill updates with Git; do not reinstall it. End the active MCP
session, then start a new Codex task so the rebuilt companion and current Skill
are loaded. Codex has no separate `mcp restart` CLI command:

- In the CLI/TUI, use `/exit` or `/quit`, then launch Codex again.
- In the desktop app, open **Settings → MCP servers** and choose **Restart**.
- In the IDE extension, open its MCP server settings and choose
  **Restart extension**.

If you launched the companion manually with `npm run mcp:start`, stop that
terminal process with Ctrl-C instead.

The registered MCP command contains absolute paths. If you move the clone or
replace the Node installation, register those paths again:

```sh
codex mcp remove graphic-design
codex mcp add graphic-design -- \
  "$(command -v node)" \
  "$PWD/packages/mcp-companion/dist/index.js" \
  --profile=full-design-v1 \
  --trusted-local
```

On Windows, repeat the PowerShell registration from step 3 after removing the
old entry.

If you created the optional global Skill link below, moving the clone also
breaks that absolute symlink target. Verify the destination is a symlink,
unlink it, and recreate it from the new repository root.

## 6. Remove it or use the Skill outside this repository

Remove only the saved MCP registration with:

```sh
codex mcp remove graphic-design
```

This removes the saved definition; exit or restart the current Codex client as
described above if it already launched the process.

The repository-local Skill needs no uninstall; Codex stops discovering it when
the task is outside the clone. If you intentionally want the Skill in every
workspace on macOS/Linux, use a POSIX shell to link the whole directory into
the current user Skill location:

```sh
mkdir -p "$HOME/.agents/skills"
ln -s "$(pwd -P)/.agents/skills/collaborate-on-graphic-design" \
  "$HOME/.agents/skills/collaborate-on-graphic-design"
```

Run that command from the repository root. It fails instead of overwriting an
existing same-name destination. Avoid keeping both a copied global package and
the repo-local package; Codex can show both same-name Skills rather than merging
them. To remove the optional link, first verify that it is a symlink, then run
`unlink "$HOME/.agents/skills/collaborate-on-graphic-design"`.

## Troubleshooting

- **Skill name is unresolved:** open the cloned repository as the Codex
  workspace, verify `.agents/skills/collaborate-on-graphic-design/SKILL.md`, and
  check `/skills`; restart Codex if it remains missing.
- **`graphic-design` is absent:** rebuild both artifacts, run `codex mcp list`,
  and repeat the registration command from the repository root.
- **`graphic-design` already exists:** inspect it with
  `codex mcp get graphic-design --json`. Do not remove an entry that belongs to
  another project; register this companion under a distinct name instead.
- **`command -v node` is empty:** activate a Node.js 22.12+ installation before
  registering; Codex needs the saved command to be an absolute executable.
- **5199 is already in use:** stop the other companion. One companion owns the
  fixed shared workbench; do not start a manual and client-managed copy
  together.
- **Chrome does not launch:** use the explicit `--chrome` form documented in
  [Getting Started](getting-started.md#chrome-does-not-launch).
- **A tool is missing:** `full-design-v1` is a fixed scope snapshot. For custom
  least-authority scopes and approval behavior, use the full
  [Agent MCP walkthrough](getting-started.md#connect-an-agent-in-about-10-minutes).

# Codex 快速入门

[English](codex-quickstart.md) · 简体中文

如果你希望 Codex 先理解平面设计需求，再在同一份可见工作台中完成搭建、测量、预览和
迭代，请使用这条路径。仓库提供两个彼此独立的部分：

| 组成 | 作用 | 设置方式 |
| --- | --- | --- |
| `collaborate-on-graphic-design` Skill | 翻译 Brief、提出艺术方向、进行审美批评和质量检查 | 在本仓库内无需安装；Codex 会从 `.agents/skills/collaborate-on-graphic-design` 自动发现 |
| Graphic Design MCP | 读写文档、取得准确渲染证据、处理资产，并打开可见的 5199 工作台 | 构建后在 Codex 中注册一次 |

没有 MCP 时，Skill 仍可帮助梳理 Brief 和艺术方向，但不能声称已经修改或测量文档。MCP
提供可靠的执行原语，却不会自动带来审美协作方法。两者一起使用，才是完整工作流。

## 1. 克隆并构建

你需要 Node.js 22.12 或更新版本、Git、Codex，以及支持 WebGPU 的 Chrome/Chromium。

```sh
git clone https://github.com/EpocheDrift/a-psychos-gd-tool.git
cd a-psychos-gd-tool
./scripts/setup.sh
npm run build:agent
npm run build:mcp
```

`setup.sh` 会校验 Node 和仓库内置字体，再严格安装 lockfile。后两条命令分别构建浏览器
产物和本地 stdio MCP 入口。重复执行这三条命令是安全的。

## 2. 用 Codex 打开这个仓库

把克隆后的仓库或它的子目录设为 Codex workspace，并在 clone 后新建一个 task。Codex
会从 `.agents/skills/collaborate-on-graphic-design` 自动发现 repo-local Skill；这里
没有额外的 Skill 安装命令，也不会把副本写入你的 home 目录。

需要显式调用时，在 prompt 中写 `$collaborate-on-graphic-design`。如果 Codex 没有把
这个名字识别为 Skill，可以在 CLI 或 IDE extension 中用 `/skills` 检查；desktop app
则从侧栏打开 **Skills**。Codex 通常会自动发现 Skill 更新；若仍缺失或版本未更新，请确认
当前 task 位于本仓库内、Skill 文件确实存在，然后重启 Codex。

## 3. 注册 MCP Companion

下面的命令适用于 macOS/Linux 的 POSIX shell。它会写入一条 user-level Codex MCP
配置，并有意冻结 Node 和 clone 的绝对路径。在仓库根目录执行：

```sh
codex mcp add graphic-design -- \
  "$(command -v node)" \
  "$PWD/packages/mcp-companion/dist/index.js" \
  --profile=full-design-v1 \
  --trusted-local
```

Windows 用户可在仓库根目录用 PowerShell 执行等价命令：

```powershell
$gdNodePath = (Get-Command node).Source
$gdRepoPath = (Get-Location).Path
$gdEntryPath = Join-Path $gdRepoPath 'packages/mcp-companion/dist/index.js'
codex mcp add graphic-design -- $gdNodePath $gdEntryPath --profile=full-design-v1 --trusted-local
```

Shell 会先把 Node 可执行文件和仓库位置展开为绝对路径，再交给 Codex 保存。这样可以避免
Desktop 与 NVM 的 `PATH` 不一致，也让 Codex 自己管理 stdio 进程。同一个 session 中不要
再另外运行 `npm run mcp:start`。

这里有意要求显式注册，因为本地 stdio server 使用每台机器不同的路径。Skill metadata
不会编造一个并不存在的通用 MCP URL，也不会静默修改用户的 Codex 配置。

`full-design-v1` 会授予当前版本的 `read`、`preview`、`edit`、`assets` 和 `model`
设计 scopes。`--trusted-local` 表示：主动启动这个只监听本机回环地址的进程，本身就视为
批准。它只适合你信任的个人 clone。若要使用需要浏览器逐项批准的最小权限路径，请去掉这
两个参数，并阅读[权限教程](getting-started.zh-CN.md#3-先从只读开始)。

## 4. 验证并开始设计任务

如果 Codex 客户端在注册前已经打开，请先 reload 或重启，再确认它已经保存 MCP：

```sh
codex mcp list
codex mcp get graphic-design --json
```

列表中应该出现 `graphic-design`；JSON 应该显示 Node、`dist/index.js` 的绝对路径，
以及两个 profile 参数。在 Codex TUI 中，`/mcp` 应显示活动 server；desktop app 与 IDE
extension 也会在 MCP server 设置中显示同一状态。然后在本仓库中开启新的 Codex task，
先运行这条不写入的 preflight：

```text
Use $collaborate-on-graphic-design. 在设计或修改任何内容之前，先通过
Graphic Design MCP 调用 gfx_get_capabilities 和 gfx_get_document。告诉我当前
frame、revision、layers 和可用 design scopes，然后停止。
```

这一步验证的是真实 Skill 解析和真实 `gfx_*` 工具访问，而不只是已保存的配置。随后再开始
设计对话：

```text
Use $collaborate-on-graphic-design.

我想为[受众与使用场景]设计一份[作品类型]。它应该更像[希望的感觉]，而不像[避免的
感觉]。必须使用的文案和素材是[...]。

先把我的意图复述成视觉关系，并提出两个真正不同的方向，等我选择。选定后，通过
Graphic Design MCP 读取当前文档和能力，执行这个方向，检查非故意越界，展示准确的
preview 证据，再向我询问聚焦的审美反馈。
```

Codex 启动 Companion 时，会打开 `http://127.0.0.1:5199` 的 Chrome 窗口。请保持
它可见：这是人和 Agent 共用的工作台，不是状态页。`npm run dev` 通常打开的 5173 页面
只用于源码开发，并未连接 MCP。

第一次下载 RMBG-1.4 模型时，仍需要人在 5199 窗口单独确认许可证；Trusted Local 不会
绕过这个决定。

## 5. 更新或移动 clone

更新仓库时执行：

```sh
git pull --ff-only
./scripts/setup.sh
npm run build:agent
npm run build:mcp
```

repo-local Skill 会随 Git 一起更新，不需要重新安装。结束当前 MCP session，再建立新的
Codex task，让重新构建的 Companion 和最新 Skill 被加载。Codex CLI 没有单独的
`mcp restart` 命令：

- CLI/TUI：使用 `/exit` 或 `/quit`，再重新启动 Codex；
- desktop app：打开 **Settings → MCP servers**，选择 **Restart**；
- IDE extension：打开 MCP server 设置，选择 **Restart extension**。

如果是用 `npm run mcp:start` 手动启动的 Companion，请在那个 terminal 中按 Ctrl-C。

MCP 注册信息包含绝对路径。如果移动了 clone，或替换了 Node 安装位置，请重新注册：

```sh
codex mcp remove graphic-design
codex mcp add graphic-design -- \
  "$(command -v node)" \
  "$PWD/packages/mcp-companion/dist/index.js" \
  --profile=full-design-v1 \
  --trusted-local
```

Windows 用户删除旧 entry 后，重新执行第 3 步的 PowerShell 注册命令。

如果你创建了下文的可选全局 Skill link，移动 clone 也会让它的绝对 symlink target 失效。
先确认目标确实是 symlink，再 unlink，并从新的仓库根目录重新建立。

## 6. 移除，或在仓库外使用 Skill

只移除 Codex 中保存的 MCP 注册：

```sh
codex mcp remove graphic-design
```

这只删除保存的定义；如果当前 Codex 客户端已经启动了该进程，请按上文退出或重启客户端。

repo-local Skill 不需要卸载；当 task 不在这个 clone 内时，Codex 就不会发现它。如果你
确实希望在 macOS/Linux 的所有 workspace 中使用这个 Skill，可以在 POSIX shell 中把
整个目录链接到当前用户的 Skill 位置：

```sh
mkdir -p "$HOME/.agents/skills"
ln -s "$(pwd -P)/.agents/skills/collaborate-on-graphic-design" \
  "$HOME/.agents/skills/collaborate-on-graphic-design"
```

请在仓库根目录执行。若同名目标已经存在，这条命令会失败，不会覆盖它。不要同时保留一份
复制出来的全局 package 和 repo-local package；Codex 可能同时显示两个同名 Skill，而
不会把它们合并。若要删除这个可选链接，请先确认它确实是 symlink，再执行
`unlink "$HOME/.agents/skills/collaborate-on-graphic-design"`。

## 常见问题

- **Skill 名称没有被识别：**把 clone 作为 Codex workspace 打开，确认
  `.agents/skills/collaborate-on-graphic-design/SKILL.md` 存在，并检查 `/skills`；仍未出现
  时重启 Codex。
- **列表里没有 `graphic-design`：**重新构建两份产物，运行 `codex mcp list`，并从仓库
  根目录重复注册命令。
- **`graphic-design` 已经存在：**先运行 `codex mcp get graphic-design --json` 检查。
  不要删除属于其他项目的 entry；请给当前 Companion 使用另一个名称。
- **`command -v node` 没有输出：**先启用 Node.js 22.12+ 再注册；Codex 保存的 command
  必须是绝对可执行文件。
- **5199 端口已占用：**停止另一份 Companion。固定的共享工作台只能由一个进程占用；
  不要同时运行手动版本和 Codex 管理的版本。
- **Chrome 没有启动：**按[中文入门教程](getting-started.zh-CN.md#chrome-没有自动启动)
  使用显式 `--chrome` 参数。
- **缺少某个工具：**`full-design-v1` 是固定的 scope 快照。自定义最小权限及审批行为请
  阅读完整的 [Agent MCP 教程](getting-started.zh-CN.md#大约-10-分钟接入-agent)。

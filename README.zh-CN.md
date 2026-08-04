# a-psychos-gd-tool — Agent 增强下游版本

[English](README.md) · 简体中文

本仓库是
[Blake Shao 原始 `a-psychos-gd-tool`](https://github.com/blakeshao/a-psychos-gd-tool)
的 Agent-enabled downstream：它保留了在浏览器里通过 WebGPU 渲染的节点式平面
设计工作台，并加入可移植工程、本地 MCP Companion、准确的 revision/render 证据，
以及处于 Alpha 阶段的平面设计协作 Skill。

> **当前是预发布 Alpha。**需要从源码安装，API 和工程兼容性仍可能变化。这个下游
> 版本目前没有在线部署。你可以通过
> [原上游 Demo](https://a-psychos-gd-tool.vercel.app/) 体验上游的人类 Web UI，但它
> **不包含**本 Fork 的 Agent/MCP 能力。

## 选择工作台

项目有两条刻意分开的启动路径；同一个设计 Session 不要混用。

| Session | 启动方式 | 工作台 |
| --- | --- | --- |
| 只有人类 | `npm run dev` | Vite 打印的地址，通常是 `http://localhost:5173` |
| Human + Agent | 由 MCP 宿主启动 Companion | Companion 自动打开的可见 Chrome：`http://127.0.0.1:5199` |

只要 Agent 参与，**5199 就是本次 Session 唯一的工作台**。人和 Agent 在这里编辑
同一份内存文档；5173 是另一份用于源码开发的构建，不会连接 MCP。

Companion 会启动一个隔离且可见的 Chrome Context。如果你在日常浏览器里手动打开
`http://127.0.0.1:5199`，会得到 `401 Unauthorized`：临时认证 Cookie 只会发给
Companion 启动的 Context。这是刻意的安全边界，不是缺少登录页面。

## 环境要求

- Node.js 22.12 或更新版本，以及 Git
- 人类 Web UI：支持 WebGPU 的 Chrome/Edge 113+ 或 Safari 18+
- Agent Session：已安装且支持 WebGPU 的 Chrome/Chromium
- Agent Session：Codex、Claude Code 等 MCP 宿主

文档与 CI 的主要参考环境是 macOS 和 Linux，setup 脚本需要 POSIX shell。Windows
可以使用 Git Bash 或 WSL；Codex 入门还提供了 PowerShell 版 MCP 注册命令。在拥有
专门的 Windows CI 之前，请把 Windows 端到端行为视为 best-effort。

## 只有人类时快速启动

```sh
git clone https://github.com/EpocheDrift/a-psychos-gd-tool.git
cd a-psychos-gd-tool
./scripts/setup.sh
npm run dev
```

打开终端打印的地址。空白工程默认包含一个图层和一个 `Output` 节点；如果想先拆解
完成案例，可以从 **start from…** 手动选择内置示例。节点连线、保存/载入、导出和
画布操作见 [10 分钟中文海报教程](docs/getting-started.zh-CN.md)。

## Agent 快速启动

先构建显式 Agent 产物和本地 stdio Companion：

```sh
./scripts/setup.sh
npm run build:agent
npm run build:mcp
```

Codex 用户继续阅读 [Codex 中文快速入门](docs/codex-quickstart.zh-CN.md)，里面包含
准确的注册命令、repo-local Skill 与 MCP 工具验证，以及共享 5199 工作台的启动方式。
Claude Code 和其他 MCP 宿主可以阅读
[通用教程](docs/getting-started.zh-CN.md#大约-10-分钟接入-agent)。

个人工作区推荐使用固定版本的 `full-design-v1` profile 和 `--trusted-local`。启动这条
明确配置的本地进程，就代表批准它当前的 `read`、`preview`、`edit`、`assets` 和
`model` 设计 scopes；第一次下载 RMBG-1.4 仍需要人类单独确认模型许可。

## 已包含的能力

- [31 种带类型的节点](docs/node-reference.zh-CN.md)，覆盖文字、矢量、栅格、
  排版、放置、合成与输出
- WebGPU 渲染、每图层独立节点图、混合模式、Frame-aware 缓存和撤销/重做
- 内容寻址图片素材、可移植 `.gfxproject.json` 保存/载入，以及准确 PNG 导出
- revision 检查、原子提交且可安全重试的 Agent 命令层
- 只监听 loopback 的 MCP Companion、准确 render/preview 证据，以及响应式共享
  5199 工作台
- repo-local
  [`collaborate-on-graphic-design`](.agents/skills/collaborate-on-graphic-design/SKILL.md)
  Skill，明确标记为 `v0.1-alpha`
- 单元、权限边界、浏览器/WebGPU、无障碍、MCP 生命周期和 Agent E2E 检查

Skill 是协作方法，不承诺普遍或客观“好看”。正式使用前请先看
[已知限制](docs/known-limitations.zh-CN.md)。

## 安全边界

Graphic Design MCP 只暴露命名的 `gfx_*` 操作，不是通用电脑控制入口。它不会授予
shell、任意文件系统、任意 URL、浏览器导航、CDP 输入或页面执行能力。替换整个工程
和可移植保存/载入仍是明确的人类 UI 操作。

MCP 宿主本身可能另外拥有用户授予的 shell、workspace 或网络权限；本项目既不新增，
也不撤销这些宿主级权限。Companion 始终只监听 loopback，并保持认证和 scope 控制。
详见 [MCP 参考](packages/mcp-companion/README.md)和
[安全政策](SECURITY.zh-CN.md)。

## 文档

从[中文文档索引](docs/README.zh-CN.md)选择最短路径：

- 使用人类 Web UI；
- 连接 Codex 或其他 MCP 宿主；
- 审阅 Agent 架构与安全边界；
- 参与贡献、测试和发布；
- 了解 Alpha 协作 Skill 与证据限制。

## 质量检查

```sh
npm run typecheck              # 应用与 Companion TypeScript
npm test                       # 单元、权限和 Skill gates；不需要 GPU
npm run build                  # 人类应用、Agent 应用和 MCP Companion
npm run check:agent-build      # Agent/default 产物安全边界
npm run check:mcp              # 真实 stdio → Companion → Chrome/WebGPU 闭环
```

浏览器与 MCP 检查需要可用的 Chrome/WebGPU 环境。更细的命令和 artifact 规则见
[浏览器 Smoke 指南](docs/testing/browser-smoke.md)。

## 贡献、许可和来源

欢迎提交 Issue 和聚焦的 PR。修改前请阅读
[CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)；安全问题请使用
[私密漏洞报告流程](SECURITY.zh-CN.md)。

代码使用 [MIT License](LICENSE)。原项目由 Blake Shao 创建；本下游版本与上游 Demo
的关系见 [NOTICE.md](NOTICE.md)。仓库内置 JetBrains Mono 使用
[SIL Open Font License 1.1](public/fonts/OFL.txt)。可选下载的模型 artifact 有自己的
许可条款，不会被本仓库重新许可为 MIT。

# 已知限制

[English](known-limitations.md) · 简体中文

这是一个从源码安装、本地优先的 Alpha。下面列出的是当前真实产品边界，不是暗示一定
会实现的路线图承诺。

## 发布与支持状态

- 已发布版本以
  [GitHub Releases](https://github.com/EpocheDrift/a-psychos-gd-tool/releases) 为准。
  全绿的 `main`、归档快照 Tag 或上游部署都不等于这个 Fork 的正式发布；本下游目前
  也没有自己的在线构建。
- Package version 仍处于预发布阶段；整个 Alpha 期间，公开 API、MCP contracts、
  工程迁移策略和 setup 都可能在版本间变化。
- 安全修复只面向最新 `main`。旧 commit 和快照不单独维护，也没有响应时间 SLA。
- 原上游 Demo 不包含本 Fork 后来加入的持久化、Agent/MCP、共享 5199 工作台或协作
  Skill。

## 平台覆盖

- 需要 Node.js 22.12 或更新版本。
- 人类 Web UI 需要 WebGPU。文档支持 Chrome/Edge 113+ 与 Safari 18+，但不同浏览器、
  GPU 和驱动组合仍可能出现渲染或可用性差异。
- Agent Session 需要 Chrome/Chromium；Safari 可以运行人类 UI，但不能作为 Companion
  浏览器。
- 主要 setup 与 CI 路径覆盖 POSIX shell、Ubuntu 和 macOS。Windows 可以使用 Git
  Bash 或 WSL，Codex 文档也提供 PowerShell 注册示例，但目前没有专门的 Windows
  端到端 CI job。

## 5173 与 5199 是不同的产品入口

- `npm run dev` 通常在 5173 启动人类源码开发 UI；它没有 Agent bridge。
- 本地 MCP Companion 独占固定的 `127.0.0.1:5199` Origin，并在隔离 Chrome Context
  中启动经过认证的 Agent 构建；它不能附着到已经打开的 5173 页面。
- 同一时间只能有一个 Companion 占用 5199。端口冲突会直接启动失败，不会自动换到
  其他 Origin。
- 日常浏览器手动访问 5199 会得到 `401 Unauthorized`。目前没有“在我的日常浏览器
  打开”的配对流程。
- Companion 浏览器使用临时 Profile/Context，不继承个人 Cookie、扩展或网站存储。
  如果作品需要跨 Session 保留，请在关闭 Companion 前保存可移植工程。

## Agent 与 MCP 范围

- MCP Companion 是从本源码树安装的本地 stdio 进程；目前没有 hosted MCP endpoint
  或云端多用户服务。
- Companion 只提供 allowlist 内的设计操作，不提供 shell、任意文件系统、任意 URL、
  浏览器导航、CDP 输入或页面执行。MCP 宿主可能另外拥有用户授予的权限。
- 替换整个工程和可移植工程保存/载入仍是人类 UI 操作。Agent 可以通过验证后的事务
  修改当前文档，但不能通过本 MCP 静默替换整个工程。
- `full-design-v1` 是当前 scopes 的固定快照，未来 scope 不会自动加入。Trusted Local
  免去的是这条明确 profile 的重复配对，不是全部人类决策。
- 第一次下载 RMBG-1.4 仍需人类单独审阅模型许可。可选模型 artifact 有自己的条款，
  不属于本仓库 MIT License 的覆盖范围。
- 平面设计协作 Skill 目前是 `v0.1-alpha`。现有实验只是有限的过程证据，不能证明跨
  用户、模型、字体和媒介都具有稳定审美、自主性或生产质量。

## 文档与输出限制

- 浏览器工作存储不是可移植备份。请使用 **save project** 下载
  `.gfxproject.json`；关闭 5199 Session 前尤其要这样做。
- 未知的新 Schema field、节点类型或参数会 fail closed。新版本保存的工程不保证能被
  旧版本载入。
- 当前人类导出路径只生成 PNG，尚未实现可编辑的 Illustrator/SVG 导出。
- 目前没有专门的 Crop 节点；文字、矢量、栅格、排版和 elements 操作仍限于现有
  31 种节点。
- 准确的 revision/render 证据只能证明哪份文档状态产生了 preview；clipping 测量只
  证明与 Frame 的相交关系。两者都不能证明审美质量、视觉平衡、作品无障碍程度或
  真实发布场景适用性。

## 本地优先不等于完全离线

- 首次 setup 会运行 `npm ci`，从配置的 npm registry 下载锁定依赖。
- 可选 RMBG-1.4 准备流程只会在人类确认后下载固定且经过完整性校验的模型 artifacts。
- Companion 本身只监听 loopback，不依赖 hosted control plane；但 MCP 宿主仍可能按
  自己的权限模型使用网络。

安装和操作入口见[中文文档索引](README.zh-CN.md)。安全问题请通过
[私密漏洞报告流程](../SECURITY.zh-CN.md)提交。

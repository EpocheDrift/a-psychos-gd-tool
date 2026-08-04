# Changelog / 变更记录

This file records user-visible changes for releases. A versioned entry becomes
an official release only when the matching annotated tag and GitHub Release
have both been published. Archive and snapshot tags are not releases.

本文件记录版本发布对应的用户可见变化。只有同时发布了匹配的 annotated tag 和
GitHub Release，版本条目才成为正式 Release；归档和快照 tag 不属于 Release。

## Unreleased

No user-visible changes yet. / 暂无用户可见变化。

## 0.1.0-alpha.0 - 2026-08-03

- The first public alpha combines the 31-node WebGPU design editor with layers,
  undo/redo, versioned local working saves, portable project save/load,
  content-addressed image assets, and the opt-in RMBG-1.4 background-removal
  workflow.
- 首个公开 Alpha 整合了包含 31 种节点的 WebGPU 设计编辑器、多图层、撤销/重做、
  带版本的本地工作存档、可移植项目保存/载入、内容寻址图片素材，以及可选启用的
  RMBG-1.4 去背景流程。
- The Agent integration adds an authenticated, least-authority local MCP
  companion and a shared Human + Agent workbench on fixed loopback port 5199.
  It includes atomic, revision-aware transactions, exact render tickets,
  bounded previews, asset scopes, recovery paths, and artifact security gates.
- Agent 集成增加了经过认证、遵循最小权限原则的本地 MCP Companion，以及固定在
  loopback 5199 端口的人机共享工作台；包含原子且感知 revision 的事务、准确渲染
  ticket、受限 preview、素材 scope、恢复路径和产物安全闸门。
- The visible 5199 workbench follows its native window, provides an accessible
  resizable split, stacks panes at narrow widths, and retains an internal scroll
  path under extreme zoom without changing exact design output.
- 可见的 5199 工作台会跟随真实窗口，提供可访问的分栏调整，在窄窗口下自动上下排列，
  并在极高缩放下保留内部滚动路径，同时保持准确设计输出不变。
- A fresh clone exposes the evidence-limited `collaborate-on-graphic-design`
  alpha Skill from `.agents/skills`, with bilingual Web UI, Codex, generic MCP,
  security, contribution, and release documentation.
- 新 clone 会从 `.agents/skills` 直接发现 evidence-limited 的
  `collaborate-on-graphic-design` Alpha Skill，并提供 Web UI、Codex、通用 MCP、
  安全、贡献和发布相关的中英文文档。
- CI covers TypeScript, application and Companion tests, default/Agent artifact
  separation, real stdio + Chrome/WebGPU Agent round-trips, stable browser
  smokes, CodeQL, dependency updates, bundled-font integrity, and release-version
  alignment. Local development requires Node.js 22.12+ and the lockfile.
- CI 覆盖 TypeScript、应用与 Companion 测试、普通/Agent 产物隔离、真实 stdio +
  Chrome/WebGPU Agent 闭环、稳定浏览器 smoke、CodeQL、依赖更新、内置字体完整性和
  发布版本一致性；本地开发要求 Node.js 22.12+ 并使用 lockfile。

Known alpha boundaries / Alpha 已知边界：

- This is a source release; neither workspace package is published to npm.
- 这是源码 Release；两个 workspace package 均未发布到 npm。
- Agent collaboration requires a local WebGPU-capable Chrome/Chromium session
  owned by the Companion on port 5199. Project replacement and portable
  save/load remain explicit human UI actions.
- Agent 协作要求由 Companion 在 5199 端口管理支持 WebGPU 的本地 Chrome/Chromium
  会话；项目整体替换和可移植保存/载入仍是明确的人类 UI 操作。
- RMBG-1.4 model files are not bundled. First download requires explicit human
  approval; the model license permits non-commercial use and requires a
  separate BRIA agreement for commercial use.
- RMBG-1.4 模型文件不会随项目打包；首次下载需要人类明确确认。该模型许可证允许
  非商业使用，商业使用需要另行与 BRIA 签署协议。
- The graphic-design collaboration Skill is evidence-limited alpha guidance,
  not a guarantee of aesthetic quality or cross-environment stability.
- 平面设计协作 Skill 属于证据有限的 Alpha 指南，不保证审美质量或跨环境稳定性。

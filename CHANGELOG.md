# Changelog / 变更记录

This file records user-visible changes for tagged releases. The project has not
published an official tag yet; current work remains under **Unreleased**.

本文件记录正式 tag 对应的用户可见变化。项目目前尚未发布正式 tag，现有工作均归入
**Unreleased**。

## Unreleased

- A fresh clone now exposes the alpha graphic-design collaboration Skill from
  `.agents/skills` without a separate install, with bilingual Codex setup,
  verification, update, and removal guidance for the local MCP companion.
- 新 clone 现在会从 `.agents/skills` 直接发现 alpha 平面设计协作 Skill，无需额外安装；
  同时补齐了本地 MCP Companion 的双语 Codex 注册、验证、更新和移除说明。
- Agent-ready v1 provides the shared 5199 Web UI and bounded local MCP
  companion.
- Agent-ready v1 提供共享的 5199 Web UI 和有明确权限边界的本地 MCP Companion。
- The visible 5199 workbench now follows its native window, provides an
  accessible resizable split, and stacks its panes at narrow widths without
  changing exact design output. Extreme zoom retains an internal scroll path,
  and temporary layout clamping does not overwrite the preferred split.
- 可见的 5199 工作台现在会跟随真实窗口，提供可访问的分栏调整，并在窄窗口下自动
  上下排列，同时保持准确设计输出不变。极高缩放下仍有内部滚动路径，临时布局约束也
  不会覆盖用户偏好的分栏比例。
- Local development now requires Node.js 22.12+ and uses a reproducible
  lockfile plus bundled-font verification.
- 本地开发现在要求 Node.js 22.12+，并使用可复现的 lockfile 和内置字体校验。

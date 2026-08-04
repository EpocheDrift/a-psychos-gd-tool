# 文档索引

[English](README.md) · 简体中文

这里把用户教程、Agent 接入、工程参考和实验性证据分开。按照你正在做的事情选择入口
即可；普通使用不需要先读完整架构和评测记录。

## 选择路径

| 目标 | 从这里开始 | 包含内容 |
| --- | --- | --- |
| 自己做一张海报 | [中文入门](getting-started.zh-CN.md) | 克隆、5173 Web UI、第一张节点图、保存/载入、导出和排错 |
| 查询节点 | [中文节点参考](node-reference.zh-CN.md) | 31 种公开节点、连线类型和简明用途 |
| 用 Codex 做设计 | [Codex 中文快速入门](codex-quickstart.zh-CN.md) | Repo-local Skill、准确的 MCP 注册、5199 preflight、第一条设计 prompt、更新和移除 |
| 使用其他 MCP 宿主 | [中文入门的 Agent 章节](getting-started.zh-CN.md#大约-10-分钟接入-agent) | 与宿主无关的启动、scopes、交互式批准和排错 |
| 操作或审阅 Companion | [本地 MCP Companion 参考](../packages/mcp-companion/README.md) | 工具、profiles、生命周期、认证、health 和验证 |
| 了解当前约束 | [已知限制](known-limitations.zh-CN.md) | Alpha 状态、平台覆盖、5199 行为、输出限制和证据边界 |
| 审阅 Agent 架构 | [Agent 适配概览](agent-adaptation/README.md) | Domain API、事务、revision/render 证据、transport 和安全决策 |
| 参与代码贡献 | [中文贡献说明](../CONTRIBUTING.zh-CN.md) | 本地检查、聚焦 PR、浏览器/MCP 要求和安全报告 |
| 运行浏览器验证 | [浏览器与 WebGPU Smoke](testing/browser-smoke.md) | Chrome 前提、单项 suite、环境变量和 artifacts |
| 准备发布 | [中文发布流程](releasing.zh-CN.md) | 版本 PR、必需证据、tag、GitHub Release 和回滚 |
| 审阅依赖风险 | [中文依赖安全基线](dependency-security.zh-CN.md) | 当前例外、可达性、缓解措施和到期时间 |
| 查看产品方向 | [公开 Alpha 路线图](roadmap.zh-CN.md) | 当前基线、暂缓决策，以及产品、上游贡献、Research 和 Release 线路的生命周期 |

## 工作台规则

端口是产品边界的一部分，不是个人偏好：

- **只有人类：**运行 `npm run dev`，使用 Vite 打印的地址，通常是
  `http://localhost:5173`。
- **只要 Agent 参与：**由 MCP 宿主启动 Companion，并把它自动打开的可见 Chrome
  `http://127.0.0.1:5199` 作为唯一工作台。

两个页面不会共享文档或 Agent bridge。在日常浏览器里手动访问 5199 会返回
`401 Unauthorized`，因为只有 Companion 启动的隔离 Chrome Context 会收到临时认证
Cookie。

## 哪份文档具有权威性？

- 当前 runtime 行为以已 checkout 的代码、生成的 capability manifest 和
  [Companion 参考](../packages/mcp-companion/README.md)为准。
- 安装和操作以两份快速入门为准。
- 安全支持与私密报告以 [SECURITY.zh-CN.md](../SECURITY.zh-CN.md) 为准。
- 架构和脱敏实验记录用于解释决策与证据，不会覆盖实时 capability contract。

## Alpha 平面设计协作 Skill

repo-local
[`collaborate-on-graphic-design`](../.agents/skills/collaborate-on-graphic-design/SKILL.md)
Skill 用于理解 Brief、比较艺术方向、通过 MCP 执行和组织审美反馈。它目前是
`v0.1-alpha`：可以作为工作方法，但不保证审美质量或跨用户、跨模型稳定。对应 evaluator
suite 属于工程/研究材料，不是新用户教程。

## 项目政策

- [已知限制](known-limitations.zh-CN.md)
- [公开 Alpha 路线图](roadmap.zh-CN.md)
- [安全政策](../SECURITY.zh-CN.md)
- [贡献说明](../CONTRIBUTING.zh-CN.md)
- [变更记录](../CHANGELOG.md)
- [许可证](../LICENSE)
- [来源与第三方声明](../NOTICE.md)

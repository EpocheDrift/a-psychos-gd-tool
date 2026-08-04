# 公开 Alpha 路线图

[English](roadmap.md) · 简体中文

这份文档记录产品方向和决策门槛，不代表已经承诺发布日期。当前实际行为和限制仍以
[已知限制](known-limitations.zh-CN.md)为准。

## 当前基线

`v0.1.0-alpha.0` 是整理后的第一个公开 Alpha，已经包含：

- 普通人可以从源码安装并使用的平面设计 Web UI；
- 本地 MCP Companion：只要 Agent 参与，人和 Agent 就共享经过认证的 5199 工作台；
- 有版本的项目 Schema、Domain Commands、事务、持久化和 revision/render 证据；
- 公开的测试、CI、Agent E2E、CodeQL、安全说明和中英文入门文档；
- 一个审美证据边界写清楚了的 Alpha 平面设计协作 Skill。

这已经是一个可以对外使用和继续迭代的产品基线，但还不是 Production `1.0`。目前它是
源码发布、本地优先：两个 package 仍是 private，没有承诺支持的 npm 安装包或本 Fork
托管站点，也不支持多人远程协作。

## 仓库的四条线路

| 线路 | 用途 | 生命周期 |
| --- | --- | --- |
| `origin/main` | 可安装、文档清楚、测试通过的公开产品 | 始终保持 Alpha 级可发布；产品改动通过聚焦 PR 进入 |
| `upstream-contrib/<topic>` | 准备贡献给 Blake Shao 原项目的通用改动 | 需要时从最新 `upstream/main` 创建；提交小型上游 PR；结束后删除 |
| `research/<topic>` | 有明确边界的审美、协议或能力实验 | 只有实验进行时才创建；原始证据不进入产品叙事；成熟成果通过单独 PR 晋升 |
| tags | 不可变的历史快照与正式版本 | 历史状态使用 annotated snapshot tag；受支持版本使用 `v*` tag 加 GitHub Release |

这里的前缀是“需要时才使用的命名空间”，不是必须长期存在的占位分支。空的
`research/*` 或 `upstream-contrib/*` 不会保存任何有价值的状态，反而会让人困惑。

## 接下来做什么

### Alpha 打磨

- 通过真实的人与 Agent 协作 Session，发现安装、恢复、渲染和交互体验中的回归。
- 持续维护 CI、CodeQL、Contract Fixtures、MCP E2E 和依赖审查。
- 当同一个问题被用户反复问到时，补齐入门说明和有代表性的 Example。
- 在稳定版之前逐步拆分过大的 Runtime 模块、合并重复的测试/检查 Harness，降低维护和
  Review 成本，但不以牺牲契约与回归覆盖为代价。
- 按[依赖安全基线](dependency-security.zh-CN.md)记录的期限，重新审查当前依赖例外。

### 有证据后再推进

- 有真实需求和可复现证据时，再扩大平台覆盖。
- 在对协作 Skill 做更多审美评测后，才对设计质量做更强的承诺。
- 只有当 MCP 打包或新的安装方式确实能降低配置成本、同时不削弱本地安全边界时，
  才决定是否推进。

### 需要单独立项的产品决策

下面几项在实现前都需要独立 RFC 和清楚的支持方案：

- 与准确 Release 绑定、面向普通用户的本 Fork 托管 Web UI；
- 远程或多用户 Agent Session；
- 公开 npm package 或预构建应用产物。

## 贡献回上游

先和 Blake 讨论一个足够小的能力或修复。对方有兴趣后，从最新的 `upstream/main`
直接创建 `upstream-contrib/<topic>`，只带上最小且普遍有用的改动，再向原仓库提 PR。
完整的 Agent Fork 历史不是一个适合让上游一次审查的单位。

## Research 如何进入产品

原始 Prompt、生成资产、私密反馈和重复的 Session 证据不放进 `main`。确实需要保留完整
历史状态时，用不可变 Tag 拍快照；公开文档只保留脱敏后的研究总结。只有当实验成果有
稳定契约、聚焦实现、对应测试和清楚的产品解释时，才通过一个单独 PR 进入 `main`。

## 我们明确不做的事

- 不为了让行数变小而删除测试、CI、安全边界、Schema 或 Contract Fixtures。
- 不创建长期 Archive Branch 或空的占位分支。
- 不把整个下游 Feature Set 当成一个 PR 塞给上游。
- 不把探索性结论写成已经交付的产品承诺。

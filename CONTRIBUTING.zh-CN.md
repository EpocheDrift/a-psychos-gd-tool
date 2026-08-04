# 参与贡献

[English](CONTRIBUTING.md) · 简体中文

## 本地准备

使用 Node.js 22.12 或更新版本；CI 的参考环境是 Node 22。

```sh
./scripts/setup.sh
npm run typecheck
npm test
```

初始化脚本通过 `npm ci` 严格安装 lockfile 中的依赖，并校验仓库内置字体，不再下载
会随时间变化的构建输入。

## Pull Request

每个分支只处理一个明确主题，不要把无关改动混入 PR。提交前至少运行与改动相关的
检查。如果行为、兼容边界或设计还没有达成共识，请先开 bug/feature Issue；小型文档和
测试修复可以直接提 PR。

按改动类型选择最低验证：

| 改动 | 最低本地证据 |
| --- | --- |
| 文档或仓库元数据 | `npm run check:versions`，并检查改动过的链接 |
| TypeScript 或 UI 行为 | `npm run typecheck` 和 `npm test` |
| Agent build 或 controller | `npm run check:agent-artifacts` |
| MCP protocol 或 Companion | `npm run check:mcp` |
| 渲染或浏览器交互 | browser smoke 指南中对应的检查 |

通用基线为：

```sh
npm run typecheck
npm test
npm run check:agent-artifacts
```

涉及渲染、浏览器或 MCP 的改动，还需要按照
[浏览器 smoke 指南](docs/testing/browser-smoke.md)执行对应检查。

只要 Agent 参与设计，本次会话就从共享的
`http://127.0.0.1:5199` 工作台开始；人和 Agent 全程使用同一个 5199 工作台。

CI 必须通过才能合并。安全问题请按 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)
私密报告，不要公开创建漏洞 Issue。

## Fork 与上游策略

这个仓库是带 Agent 能力的下游发行版。依赖 MCP、持久化或 Agent 契约的改动应提交到
本仓库 `main`。如果修复对 Blake Shao 的原版也普遍有用，请把它与下游专属代码隔离，
从上游当前 `main` 新建分支，再单独向
[`blakeshao/a-psychos-gd-tool`](https://github.com/blakeshao/a-psychos-gd-tool)
提案；不要让上游一次审查整段下游历史。

准备开始实现上游贡献时，直接从上游当前分支创建一个按需分支：

```sh
git fetch upstream main
git switch -c upstream-contrib/topic-name upstream/main
```

这个分支的 PR 目标是原仓库的 `main`。不要只是为了保存分支而把它合并回本 Fork；如果
其中有适合下游产品的改动，应另开一个聚焦的产品 PR 进入 `origin/main`。

`research/<topic>` 只用于有明确边界、正在进行的实验。原始 Prompt、资产和重复的
Session 证据不进入 `main`；成熟成果通过聚焦、有测试的产品 PR 晋升。Snapshot Tag 和
Release Tag 都保持不可变。这些分支前缀只在需要时创建，仓库不保留空的占位分支。当前
决策门槛见[公开 Alpha 路线图](docs/roadmap.zh-CN.md)。

提交贡献即表示你同意按本仓库的 [MIT License](LICENSE) 许可该贡献。

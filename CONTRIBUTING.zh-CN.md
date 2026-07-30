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
检查：

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

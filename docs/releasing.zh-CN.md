# 发布流程

[English](releasing.md) · 简体中文

项目目前仍是预发布状态。只有线上地址、绿色的 `main` 构建或一个 tag，本身都不等于
Release。只有 annotated 版本 tag 与匹配的 GitHub Release 同时存在时，才属于项目发布。
`pre-public-curation-*` 这类快照和归档 tag 只保存历史，不属于 Release，也不承诺支持。

`v0.x` 发布（包括 `v0.1.0-alpha.0` 这类预发布版本）按以下流程执行：

1. 创建版本 PR，同时更新根 package 与 Companion package 的版本、
   `package-lock.json` 中对应的根/workspace 条目、Companion 共享运行时版本常量和
   changelog。除非另行批准 npm 发布，否则两个 package 都继续保持 private。
   `npm run check:versions` 必须通过。
2. 从干净的 lockfile 安装开始，通过必需 CI、`npm run build`、完整本地浏览器 smoke、
   在 UI 或启动策略变化时执行可见的 5199 release check，以及依赖安全复查。准确命令和
   证据规则见[浏览器 smoke 指南](testing/browser-smoke.md)。
3. 在目标浏览器/GPU 上人工检查保存的视觉证据，并记录浏览器版本、操作系统和所用
   GPU/环境；重新确认每一条例外依赖风险和 RMBG-1.4 许可边界。
4. 合并版本 PR，从这个准确的 `main` commit 创建 annotated
   `vX.Y.Z[-prerelease]` tag 并推送，不移动任何已有 tag。CI 会对 `v*` tag 再运行一次，
   并验证 tag 与所有 package/runtime 版本面完全一致；等待 tag CI 通过。
5. 从这个已有 tag 创建 GitHub Release。Alpha/Beta 必须标记为 **pre-release**，并写清
   用户可见变化、已知限制、安装方式、测试浏览器/GPU、已接受的安全例外，以及回滚
   commit 或上一版本。
6. 只有验证线上地址确实提供该 Release 的准确 commit 后，才在 Release 中记录生产部署
   URL，并同时写下 URL 与 commit。

非版本归档 tag 可以使用描述性名称，发布版本检查会有意忽略它们；归档 tag 不要使用
`v` 前缀。

在 MCP Companion 的打包产物包含项目许可证与所有必要第三方声明、并通过全新环境
安装测试之前，不发布到 npm。`0.1.0-alpha.0` 是源码 Release：在打包义务另行审批通过
之前，不附带打包后的 Companion 或 Web 构建产物。可选 RMBG-1.4 工作流如用于商业
场景，必须另外确认模型条款；发布本项目源码并不授予模型的商业使用权。

回滚应重新部署或检出上一个已记录的 Release commit；不要移动已经发布的 tag。

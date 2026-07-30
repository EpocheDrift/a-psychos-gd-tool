# 发布流程

[English](releasing.md) · 简体中文

项目目前仍是预发布状态，还没有正式 tag。只有线上地址或 `main` 构建为绿色，并不
等于已经完成一次正式发布。

第一次以及后续 `v0.x` 发布按以下流程执行：

1. 创建版本 PR，同时更新两个 package 的版本、Companion 共享运行时版本常量和
   changelog，并确保 `npm run check:versions` 通过。
2. 通过必需 CI、完整本地浏览器 smoke，以及依赖安全复查。
3. 在目标浏览器/GPU 上人工检查保存的视觉证据。
4. 合并版本 PR，并从这个准确的 `main` commit 创建 annotated `vX.Y.Z` tag。
5. 创建 GitHub Release，写清用户可见变化、已知限制、测试浏览器/GPU 和回滚
   commit。
6. 如果上线生产环境，在 Release 中记录部署地址及其准确 commit。

在 MCP Companion 的打包产物包含许可证、并通过全新环境安装测试之前，不发布到
npm。商业发布还需要完成 Agent 适配文档里已经记录的 RMBG-1.4 独立许可决策。

回滚应重新部署或检出上一个已记录的 Release commit；不要移动已经发布的 tag。

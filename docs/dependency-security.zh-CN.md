# 依赖安全基线

[English](dependency-security.md) · 简体中文

基线日期：2026-10-21

## 当前结果

对已提交 lockfile 执行 `npm audit` 和 `npm audit --omit=dev --omit=optional`，
结果均为 **0 条漏洞告警**。目前不再保留依赖例外。这是基于当日公告库的审计结果，
不代表对未知漏洞的保证。

本次安全更新包括：

- MCP SDK 1.32.1、Hono 4.13.13、proxy-addr 2.0.8，以及兼容的 URI/Query 解析修复；
- Transformers.js 4.3.1 及其支持的 ONNX Runtime Node 1.30.0、adm-zip 0.6.1、
  sharp 0.35.5 依赖链；
- Vitest 5.0.5，移除了旧的有漏洞的 Worker Pool 依赖；同时更新 Vite 7.3.7、
  浏览器数据和 Source Map 相关依赖。

7 月记录的 Node 原生压缩包/图像依赖例外已通过 Transformers.js 官方支持的依赖链
解决。这次没有通过跨版本 override 或忽略告警来得到零告警结果。

## 运行时边界

项目只在浏览器 Remove Background Worker 中使用 Transformers.js；生产浏览器产物
选择的是 `onnxruntime-web`，不会打包或调用 Node 原生的 `onnxruntime-node`、
`adm-zip` 或 `sharp` 路径。产物门禁会拒绝浏览器 bundle 中出现 Node 原生
runtime/archive/image 标记；发布审查也必须继续验证这条边界。

Companion 使用 stdio MCP 和 `node:http` loopback 服务，并直接检查 socket 地址；
工作台认证不使用 Express 的代理信任判断。虽然存在漏洞的认证路径不在 Companion 中
使用，间接依赖 proxy-addr 的 Critical 告警仍已在 lockfile 中修复。

## 复查规则

CI 在按 lockfile 安装后运行 `npm audit --audit-level=high`。High 和 Critical 会让
必需的测试任务失败；较低级别的告警仍需要审查。不能为了合并而绕过检查或忽略告警。

每次依赖更新、新告警和发布都要复查。除了审计结果，还要验证类型、单元测试、生产
产物边界，以及真实 MCP/Chrome/WebGPU 检查。如果依赖路径变得可达，或构建开始打包
Node 原生依赖，必须重新进行安全审查。

GitHub 发现有可用修复时，Dependabot 会把相关安全更新汇总为 PR；普通
minor/patch 每周检查一次。major 更新仍然保持为单独的人工决策。

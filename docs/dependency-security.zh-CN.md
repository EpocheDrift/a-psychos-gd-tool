# 依赖安全基线

[English](dependency-security.md) · 简体中文

基线日期：2026-07-29

## 当前结果

完整依赖审计和 `npm audit --omit=dev --omit=optional` 目前都报告 4 个 high、
0 个 critical。

本次已经通过升级 MCP SDK、Hono adapter、Vite、esbuild、PostCSS 和 protobufjs
修掉所有可安全修复的告警。剩余 4 个 package 条目实际来自 2 个上游公告：

```text
@huggingface/transformers 4.2.0
├─ onnxruntime-node 1.24.3
│  └─ adm-zip 0.5.17 — GHSA-xcpc-8h2w-3j85
└─ sharp 0.34.5 — GHSA-f88m-g3jw-g9cj
```

Transformers 和 onnxruntime-node 是这两个公告向上汇总出来的 audit 条目，不代表
又多了两个独立漏洞。

项目只在浏览器 Remove Background Worker 中使用 Transformers.js；生产浏览器产物
选择的是 `onnxruntime-web`，不会打包或调用 Node 原生的 `onnxruntime-node`、
`adm-zip` 或 `sharp` 路径。产物门禁会拒绝浏览器 bundle 中出现 Node 原生
runtime/archive/image 标记；发布审查也必须继续验证这条边界。

上游目前没有兼容修复。我们不通过跨越 `0.x` 兼容边界强行 override 原生包，因为
那样可能只是制造一套没有验证过的运行时，并没有真正降低风险。

## 复查规则

每次 Transformers.js 更新或出现新告警时都要复查；最迟复查日期为 2026-10-29。
一旦上游提供兼容版本，就移除这项例外。任何 critical 告警、原生路径变得可达，
或构建开始打包 Node 原生依赖，都必须暂停发布并重新审查。

GitHub 发现有可用修复时，Dependabot 会把相关安全更新汇总为 PR；普通
minor/patch 每周检查一次。major 更新仍然保持为单独的人工决策。

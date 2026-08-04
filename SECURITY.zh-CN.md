# 安全政策

[English](SECURITY.md) · 简体中文

## 支持范围

本项目仍处于预发布阶段。安全修复以最新的 `main` 为目标；必要时会用修复后的 Alpha
替换最新 GitHub Release。带 tag 的 Alpha 是经过测试的参考点，不是长期支持分支。只有
匹配 GitHub Release 的 tag 才属于 Release；包括 `pre-public-curation-*` 在内的快照和
归档 tag 不获得单独安全支持。目前不承诺固定的响应时限或维护 SLA。

## 报告漏洞

请使用
[GitHub 私密漏洞报告](https://github.com/EpocheDrift/a-psychos-gd-tool/security/advisories/new)。
在修复或协调披露准备好之前，请不要公开创建漏洞 Issue。

报告中请包含受影响的 commit、复现步骤、影响和建议的缓解方式。不要附带凭据、
私人项目文件、模型缓存内容或他人的数据。

当前已经审查并暂时接受的依赖风险及复查期限，记录在
[依赖安全基线](docs/dependency-security.zh-CN.md)。

# AE-20260801-poster-recovery — 重启后的狗尿告示确定性恢复

状态：**Complete — N/U 已确定性恢复并完成 exact-hash 验证**

Spec 版本：**0.1.0**

Playbook 版本：**0.1.0**

日期：**2026-08-01**

负责人：**项目所有者 × Codex**

## 1. 预注册

### 研究问题

- RQ1：电脑重启且浏览器临时项目未保存后，能否只依靠已记录的 MCP transaction
  确定性恢复项目所有者已经接受的 N/U 两张狗尿告示？
- RQ2：恢复后的 exact-ticket large preview 是否与重启前的 PNG content hash 和 RGBA
  hash 完全一致？

### 假设

- H1：相同 Git capability、default font、frame 和 transaction 参数会重建相同文档
  关系，并产生相同 RGBA 像素。
- H2：N/U 在同一设计 transaction 中恢复，再用独立 visibility transaction 切换，
  可以恢复重启前最终项目状态而不产生任何新审美版本。

### 任务族

**T6 — 诊断并恢复现有设计**。本 Session 只验证恢复可靠性，不进行审美改进。

### 固定任务与完整文案

- 恢复 `N - Controlled Breach` 与 `U - Brutal Underground` 两个设计图层；
- 固定英文文案：`DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`；
- frame：1080 × 1350；
- 纯文字、无资产；
- 恢复来源：
  `test-results/agent-aesthetic/AE-20260731-T5-two-kinds-of-cool/design-both.json`；
- 恢复来源 SHA-256：
  `03baf16e87d5999af7d043279873107e3832e82eb76e1fd0d8dc86e5a62d27ba`；
- 不改变任何 node、param、edge、layer name、颜色、字体、frame 或构图关系；
- 最终 visibility 与重启前一致：N hidden，U visible。

### 条件

单条件 **R — Exact reconstruction**：

1. 新 Trusted Local Companion 必须从 revision 0 的默认空白文档开始；
2. 读取保留的 98-command transaction，在内存中只替换本 Session request ID 与
   `dryRun` 标志；
3. dry-run 后提交同一设计计划，恢复 N visible / U hidden 的 revision 1；
4. validation、exact render、measurement 后分别捕获 N 的 1024-bound 与
   256-bound preview；
5. 只切换 layer visibility，得到 U visible / N hidden 的 revision 2；
6. 对 U 重复 validation、render、measurement 和两种 preview；
7. 比较重启前后 content hash、RGBA hash、尺寸和关键 bounds；
8. 不进行审美反馈或修订。

### 控制变量

| 变量 | 固定值 |
| --- | --- |
| Agent 产品/模型/版本 | Codex desktop；当前任务不可见精确模型版本 |
| MCP Companion/capability 版本 | Package `0.0.1`；protocol `1.0`；Git `ae13bfd`；preflight 补录实际 capability |
| 浏览器/操作系统 | Google Chrome `151.0.7922.72`；macOS `26.5.2` (`25F84`) |
| Frame | 1080 × 1350 |
| 字体条件 | `font=default` |
| 资产 | 无 |
| Scopes | `read`、`preview`、`edit`；Trusted Local |
| 初始文档 | 预期 revision `0`；2304 × 3456；默认 `layer_1` + `Output`；若不符则停止 |
| 候选数 | 2 个被恢复对象；0 个新候选 |
| 反馈轮数 | 0 |
| 时间预算 | 无硬上限；记录实际时间 |

### 主要结果

1. N recovered large preview 是否匹配原始：
   - 819 × 1024 PNG content hash
     `96fb0f0c1fafddf5009853e58824d4b7f2716363b1e7a1c9d1bd6b0b2c884e41`；
   - RGBA SHA-256
     `9d1d473c63d7557b80c14744c11bffa538d8a4ead573b12e3e46f62a05439915`。
2. U recovered large preview 是否匹配原始：
   - 819 × 1024 PNG content hash
     `0b66e3faa97b9593d823ce872b05ceea65e7fc2325c090a8b82bb25eb0f76f78`；
   - RGBA SHA-256
     `eadd405083d826ee04d335362c9469596c8cbc0ab85aeecac26ee4df63568d91`。
3. 恢复后是否同时存在 N/U 图层，并以 N hidden / U visible 结束。

### 次要结果

- 两版最终 `Place.out` 是否全部 `inside`；
- dry-run、commit、render、preview、retry 和总耗时；
- 电脑重启是否改变 capability、browser、font environment 或 PNG 编码。

### 重复次数

单次灾后恢复。它验证这一次恢复，不宣称跨机器或跨版本的普遍持久性。

### 停止规则

- preflight 不是 revision 0 干净文档时停止，不覆盖任何未知项目；
- source transaction SHA 不匹配时停止；
- dry-run 无效时只允许修正 request envelope，不允许改变设计 commands；
- 任一 large RGBA hash 不匹配时停止并报告，不通过调参逼近旧图；
- 若 RGBA 相同但 encoded content hash 不同，标记为视觉精确恢复但编码不一致；
- 两版都验证后立即停止，不产生新设计 revision。

### 盲评方式

不适用。主要结果是确定性 hash 与文档状态验证，不是审美比较。

### 已知混杂因素

- `test-results/` 是本机未提交的运行证据；本次它幸存于重启，但不是可靠的长期备份；
- Companion 项目本身未保存，恢复依赖 transaction 证据而不是 project file；
- 当前 Codex 未原生加载 `gfx_*`，仍通过本地 SDK bridge 调用 Companion；
- 相同 RGBA 证明本次视觉输出一致，不证明未来不同浏览器或字体环境仍一致。

> 完成本节后再进行第一笔 MCP 设计写入。开始时间：
> **2026-08-01 16:32:30 PDT**

## 2. Brief

### 目标

把重启前项目所有者已经接受的两张狗尿告示原样恢复到新的 Graphic Design Companion
项目中，并用重启前保留的 hash 证明没有发生视觉漂移。

### 输出与场景

1080 × 1350；N/U 两个图层；最终 UI 显示 U，N 保留为隐藏层。

### 必须内容

完整恢复原 transaction；不修改固定文案或标点。

### 信息层级

继承原 N/U；本 Session 不重新评价或调整。

### 审美意图

继承原 N/U；“成功”只表示精确恢复，不新增审美结论。

### 视觉关系

所有关系由 source transaction 固定。

### 视觉参考及参考原因

重启前 N/U exact previews 是唯一参考和 hash oracle。

### 反例与避免项

- 不凭记忆重画；
- 不为适应新环境改变字体、字号、位置、颜色或效果；
- 不把相似 preview 当成 exact recovery；
- 不覆盖非空文档。

### 必须保留

全部 98 commands、N/U 图层结构、frame、文案、颜色和 visibility 终态。

### Agent 自由度

Agent 只可更换 request ID、dry-run 标志和 visibility transaction 的 request envelope。

### 验收信号

- source SHA 匹配；
- N/U large RGBA hash 匹配；
- content hash 匹配或被明确记录为仅编码差异；
- N 7/7、U 6/6 关键组 inside；
- 最终 N hidden / U visible；
- 0 审美参数变化。

## 3. Run 记录

### AE-20260801-poster-recovery-R-R1

#### 环境与基线

- 开始/结束时间：2026-08-01 16:32:30 PDT / 2026-08-01 16:35:18 PDT
- Agent：Codex desktop；当前任务不可见精确模型版本
- MCP/capability：Package `0.0.1`；protocol `1.0`；Git `ae13bfd`；9 个
  read/preview/edit tools；`rendered-node-measurement-v1`
- Scopes：read、preview、edit；Trusted Local
- Baseline revision：`0`
- Baseline layers：2304 × 3456；`layer_1` 仅含默认 `Output`
- 与预注册的偏离：无

#### Agent 执行前解释与策略

- 使用保留的 source transaction，不重新设计；
- 在任何 preview 前同时恢复 N/U；
- 先验证 N，再只切换 visibility 验证 U；
- 用 large RGBA/content hash 判定视觉精确性；
- 任一视觉 hash 不一致即停止，不做“看起来差不多”的调参。

#### MCP trace

本公开记录将早期本地 bridge trace 中的三个 helper labels 规范化为同语义的正式 MCP tool
名称：`gfx_apply_transaction`、`gfx_measure_rendered_nodes`、`gfx_capture_preview`。Request ID、
输入语义、revision、结果与耗时保持原记录。

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_get_capabilities` | `…-capabilities-V1` | package、protocol、tools、measurement capability | 成功 | 0 | 7 ms |
| 2 | `gfx_get_document` | `…-document-preflight-V1` | 验证默认空白文档 | 成功；仅 `layer_1/Output` | 0 | 4 ms |
| 3 | `gfx_apply_transaction` | `…-design-dryrun-V1` | 原 98 commands；`dryRun=true` | 成功；proposed revision 1 | 0 | 16 ms |
| 4 | `gfx_apply_transaction` | `…-design-commit-V1` | 原 98 commands；`dryRun=false` | `transaction_1` 成功 | 0→1 | 19 ms |
| 5 | `gfx_validate_document` | `…-n-validate-V1` | N visible | 0 errors / 0 warnings | 1 | 4 ms |
| 6 | `gfx_await_render` | `…-n-await-V1` | 等待 N exact render | complete | 1 | 2 ms |
| 7 | `gfx_measure_rendered_nodes` | `…-n-measure-V1` | 7 个 `Place.out` | 7/7 inside | 1 | 4 ms |
| 8 | `gfx_capture_preview` | `…-n-large-V1` | N；1024 bound；exact ticket | 成功；819×1024 | 1 | 53 ms |
| 9 | `gfx_capture_preview` | `…-n-thumb-V1` | N；256 bound；exact ticket | 成功；204×256 | 1 | 8 ms |
| 10 | `gfx_apply_transaction` | `…-switch-U-dryrun-V1` | N hidden / U visible；`dryRun=true` | 成功；proposed revision 2 | 1 | 7 ms |
| 11 | `gfx_apply_transaction` | `…-switch-U-commit-V1` | N hidden / U visible；`dryRun=false` | `transaction_2` 成功 | 1→2 | 13 ms |
| 12 | `gfx_validate_document` | `…-u-validate-V1` | U visible | 0 errors / 0 warnings | 2 | 3 ms |
| 13 | `gfx_await_render` | `…-u-await-V1` | 等待 U exact render | complete | 2 | <1 ms |
| 14 | `gfx_measure_rendered_nodes` | `…-u-measure-V1` | 6 个 `Place.out` | 6/6 inside | 2 | 2 ms |
| 15 | `gfx_capture_preview` | `…-u-large-V1` | U；1024 bound；exact ticket | 成功；819×1024 | 2 | 50 ms |
| 16 | `gfx_capture_preview` | `…-u-thumb-V1` | U；256 bound；exact ticket | 成功；204×256 | 2 | 8 ms |
| 17 | `gfx_get_document` | `…-document-final-V1` | 验证图层、graph 与 visibility 终态 | 成功；N hidden / U visible | 2 | 2 ms |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Content hash | RGBA hash | 匹配 |
| --- | --- | --- | --- | --- | --- |
| N large | 1 | 819 × 1024 | `96fb0f0c1fafddf5009853e58824d4b7f2716363b1e7a1c9d1bd6b0b2c884e41` | `9d1d473c63d7557b80c14744c11bffa538d8a4ead573b12e3e46f62a05439915` | content 与 RGBA 均 exact |
| N thumb | 1 | 204 × 256 | `af7e4cdebc0c9fb09a55c8f078f895cbd27f6e20d151d611f3f03b10d78ceaf0` | `088fe14a1f228c0f1362eef09b9de6279455853d9ac34e7317bc9975ace2d580` | 新增恢复证据；无旧 oracle |
| U large | 2 | 819 × 1024 | `0b66e3faa97b9593d823ce872b05ceea65e7fc2325c090a8b82bb25eb0f76f78` | `eadd405083d826ee04d335362c9469596c8cbc0ab85aeecac26ee4df63568d91` | content 与 RGBA 均 exact |
| U thumb | 2 | 204 × 256 | `9310077d072cd27f3429696d8237d579995292f8bec0d72d74846c90c6955d21` | `f2ddd6bfc8bf85ebc9938150a435d2b66cd772d276153f5703f643ff35b6799e` | 新增恢复证据；无旧 oracle |

恢复 preview 路径：

- `test-results/agent-aesthetic/AE-20260801-poster-recovery/previews/recovery-n-preview-large-r1-1.png`
- `test-results/agent-aesthetic/AE-20260801-poster-recovery/previews/recovery-u-preview-large-r1-1.png`

#### Agent 两遍评价

需求与硬约束：

- 两个命名图层、完整 graph、1080 × 1350 frame 与固定文案均存在；
- N 的 7 个、U 的 6 个关键输出全部位于 frame 内；
- 最终 visibility 为 N hidden / U visible；
- transaction commands 与审美参数 0 改动。

审美质量：不重新评价；继承原 Session 的人类接受结果。

#### 人类反馈

原始恢复请求：

> 我重启了电脑，忘了保存项目还有我们已经做好的狗尿告示，你能重新recover回来吗

#### 修订及保留关系

只允许恢复和 visibility 切换；0 个审美关系改变。

#### 最终结果

- Final revision：`2`
- 停止原因：两版均通过 exact content/RGBA hash、bounds、validation 与终态验证，按预注册停止规则结束
- Tool calls：17（MCP 报告耗时合计约 202 ms）
- Transactions：2 次 dry-run；2 次 commit；0 revert
- Feedback rounds：0
- Failures/conflicts/reverts/retries：0 / 0 / 0 / 0
- 总时长：2 分 48 秒（含启动 bridge、preflight、证据比较与记录）

## 4. 评价

### Exact recovery 结果

| 对象 | 文档结构 | RGBA | PNG encoding | 最终状态 |
| --- | --- | --- | --- | --- |
| N | 完整恢复；7/7 bounds inside | exact match | exact match | hidden |
| U | 完整恢复；6/6 bounds inside | exact match | exact match | visible |

### 维度评分

不重新打审美分；沿用 T5 的人类结论“两张都达到当前 alignment 与 aesthetics”。

### Agent 与人类评价的分歧

不适用，除非恢复 hash 失败而人类认为肉眼相同。

## 5. 偏离、失败与混杂因素

- 与预注册无偏离；无失败、冲突或 retry。
- 当前 Companion 提供读、预览、编辑能力，但没有可调用的 project save/export/reopen
  capability；本次恢复的是当前运行中的浏览器项目，不等于已创建耐久 project file。
- source transaction 与 oracle preview 位于本机 `test-results/`，本次重启后仍存在，但它仍是
  灾难恢复证据而非可靠备份策略。
- 本次只证明同一机器、Git capability、Chrome 与 default-font 环境下的精确重建。

## 6. 结论

### 本 Session 支持的结论

- 在本次固定环境中，保留完整 MCP transaction 足以从 revision 0 确定性恢复两个设计图层；
- N/U 的 PNG content hash 与 RGBA hash 均和重启前完全一致，因此不是肉眼近似，而是
  pixel-exact 且 encoding-exact 的恢复；
- transaction、exact preview oracle 与关键 bounds 共同构成了一套可审计的设计恢复记录。

### 本 Session 不能支持的结论

- 不能据此声称跨机器、跨浏览器、跨字体或跨 capability 版本也一定相同；
- 不能把 `test-results/` 当作正式持久化方案；
- 不能声称当前 Companion 项目已经自动保存到可在下一次重启后直接 reopen 的 project file。

### 对 Brief 写法的启示

恢复类 brief 应明确区分“原样恢复”和“重新设计”，固定 source、终态 visibility、hash
oracle 与停止规则，避免 Agent 在灾后恢复时凭审美判断擅自改良。

### 对 Agent 工作流的启示

每个被接受版本除了 preview，还应保留可重放 transaction、capability/environment
fingerprint、关键 bounds 和 RGBA oracle。它们让恢复从“凭记忆重画”变成可验证重放。

### 对 MCP/API 设计的启示

当前工具足以重建，却缺少项目级耐久化。建议 MCP 增加明确的
`save_project` / `export_project_bundle` / `open_project` 能力，并返回稳定 project ID、保存路径、
revision 与持久化校验；否则“transaction 成功”容易被误解为“重启后仍可打开”。

### 下一步实验

把“可接受设计的恢复包”提升为正式、版本化 artifact：至少包含 source transaction、环境
fingerprint、large preview、RGBA oracle 与 reopen 指令；随后单独测试 save → restart → open，
而不是再次做审美迭代。

# AE-20260729-T6-anchor-measured-revision — 升级 MCP 后的定向海报修订

状态：**Complete — M preferred；协调性目标已完成，创意概念探索移至下一 Session**

Spec 版本：**0.1.0**

日期：**2026-07-29**

负责人：**项目所有者 × Codex**

## 1. 预注册

### 研究问题

- RQ1：升级后的 `Place` painted-bounds anchors 与 exact-ticket rendered-node
  measurement，能否在第一次向人类展示前消除意外裁切和定位原点猜测？
- RQ2：把项目所有者的“不协调，可能来自位置、字体、对称”翻译为一套明确的两列
  空间骨架，是否会比继承的 C 基线产生可感知的构图与一致性提升？
- RQ3：Trusted Local 与 render-ready startup 是否减少真实协作中的授权和会话恢复
  成本？

### 假设

- H1：显式 anchor 加节点级未裁切 bounds，可以让第一次 preview 即通过内容边界硬
  门槛，不再发生 S1 中的 preview 后横向 hard-fix。
- H2：共享列中心、共同边线与成对视觉重量会改善“不协调”，同时保留 C 的直接、
  荒诞和海报化关系。
- H3：Trusted Local 会消除本 Run 的浏览器批准轮次；它不自动提高审美质量。

### 任务族

**T6 — 诊断并改进现有设计**

### 固定任务与完整文案

- 继承 S1 的 C hard-fix 视觉基线，不继承 A/B 条件；
- frame：1080 × 1350；
- 固定英文文案：
  `DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`；
- 纯文字、纯排版，不使用图片或模型；
- 使用场景：张贴在公寓电梯或楼道附近，远距离先被感知为 typographic object，
  同时发挥 notice 功能；
- 语气：直接、稍微夸张、荒诞幽默，不辱骂、不威胁；
- 当前反馈只要求解决整体“不协调”，重点是位置系统、字体角色和对称/平衡关系。

### 条件

单条件探索性 Run：**M — Anchor + measurement 辅助的定向修订**

1. 从干净文档确定性重建 S1 C hard-fix；
2. 必须先得到与原始 baseline 完全相同的 preview content hash；
3. 只处理项目所有者已经确认的最高优先级问题：建立协调的空间骨架；
4. 在第一张设计 preview 前，使用 exact render ticket 测量所有关键
   `Place.out`；
5. 意外裁切必须在 preview 前修正；技术边界修正不计为人类反馈；
6. 展示第一张准确 preview 后，最多再接受 1 轮人类反馈。

本 Session 不把升级前后的 MCP 做因果 A/B 比较；它是一次产品验收与有用设计修订
合并的探索性案例。

### 控制变量

| 变量 | 固定值 |
| --- | --- |
| Agent 产品/模型/版本 | Codex desktop；当前任务不可见精确模型版本 |
| MCP Companion/capability 版本 | Package `0.0.1`；protocol `1.0`；Git `ae13bfd`；9 个 read/preview/edit 工具；`rendered-node-measurement-v1` |
| 浏览器/操作系统 | Google Chrome `151.0.7922.72`；macOS `26.5.2` (`25F84`) |
| Frame | 1080 × 1350 |
| 字体条件 | `font=default`；Agent 仍不可写入或枚举本地字体 |
| 资产 | 无 |
| Scopes | `read`、`preview`、`edit`；Trusted Local |
| 初始文档 | 新 Companion session revision `0`；2304 × 3456；单个默认图层与 `out` |
| 继承基线 | S1 C hard-fix；819 × 1024 hash `98e5023b73664b376c144f760e756f468784e6f81a042d9051192d268096113a` |
| 候选数 | 1 |
| 反馈轮数 | 当前已确认反馈驱动 1 次定向修订；首张 preview 后最多再 1 轮 |
| 时间预算 | 无硬上限；记录实际时间 |

### 主要结果

1. 项目所有者对 inherited C baseline 与 M revision 的 revealed 成对偏好及理由；
2. M revision 是否在首次展示前由 measurement 证明 6 个文字组均无意外裁切；
3. 构图与空间、一致性、字体与文字的 1–5 分和可观察证据；
4. 从写入到第一张合格 preview 的 transaction、retry、hard-fix 和人工授权次数。

### 次要结果

- exact render / measurement / preview 的调用成本；
- Agent 对“不协调”的解释与人类判断是否一致；
- anchors 是否减少手调 offset；
- 未实现的字体 palette 是否仍是明显质量上限。

### 重复次数

单 Run、单候选。结果仅支持该作品与本次工具验收，不形成普遍性结论。

### 停止规则

- 若重建 baseline hash 不一致，暂停，不继续设计修订；
- 第一张设计 preview 前只允许因 measurement 发现意外裁切而进行 1 次技术修正；
- 第一张准确 preview 后最多接受 1 轮人类反馈；
- 项目所有者明确表示目标达到时提前停止；
- 若 MCP capability、字体条件、文案或 frame 再次改变，停止并另建 Session。

### 盲评方式

不盲。项目所有者已经看过 inherited C，且本任务研究的是定向诊断与改进。比较结果
必须标为 revealed preference。

### 已知混杂因素

- 设计策略和 MCP 能力同时相对 S1 改变，不能把质量差异单独归因于 anchors；
- 只有项目所有者一名评价者；
- 继承设计已经吸收 S1 的 A/B 反馈；
- default font 不可更换；
- Codex 当前未原生加载 `gfx_*`，仍通过本地持久 SDK bridge 调用同一 Companion；
- Package / Companion 仍标记 `0.0.1`，因此 Git SHA 与 measurement contract 是更
  准确的能力身份。

> 完成本节后再进行第一笔 MCP 设计写入。开始时间：
> **2026-07-29 18:06:42 PDT**

## 2. Brief

### 目标

让公寓公共区域的路人在远处先看到一件醒目的纯排版作品，靠近后立即理解“狗尿不是
公寓配套设施，也不应再次发生”。荒诞感来自 `AMENITY.` 的语义反差，而不是解释
段落或攻击性措辞。

### 输出与场景

1080 × 1350 竖版，约 A4 比例；公共空间张贴；大图检查字形与边界，缩略图检查整体
重心和第一眼层级。

### 必须内容

`DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`

文字和标点不得改变。

### 信息层级

1. 第一眼：`DOG / PEE` 与高亮酸性底色；
2. 第二眼：橙红色 `AMENITY.` 荒诞重音；
3. 第三眼：`IS NOT AN`、`NOT HERE.`、`NOT AGAIN.` 完成 notice。

### 审美意图

平面、直接、稍微夸张、荒诞幽默；先像排版海报，再像传统告示。完成度来自清楚的
尺度、共同轴线和留白关系，而不是增加装饰。

### 视觉关系

- 使用两列骨架组织顶部和底部；
- 共享列中心与外边界，形成有控制的近对称；
- 中部文字横跨两列；
- `AMENITY.` 是唯一允许明显偏离硬朗秩序的波形重音；
- 垂直间距形成清楚拍点，不再像两个互不关联的上下系统。

### 视觉参考及参考原因

仅参考 inherited C 自身：保留酸性背景、近黑粗字、橙红语义重音和五段阅读逻辑。
不引入外部作品。

### 反例与避免项

- 不回到 B 的圆形印章或徽章；
- 不做标题、正文、落款式物业通知；
- 不把所有内容机械居中成普通活动海报；
- 不使用无意裁切；
- 不增加图标、狗形、尿滴或说明段落。

### 必须保留

固定文案、frame、纯文字、酸性背景、近黑主文字、橙红 `AMENITY.`、公共 notice
功能和稍微荒诞的语气。

### Agent 自由度

Agent 可调整各短语的字号、字重、anchor、网格、间距和 `AMENITY.` 波形幅度；
不得更换字体、颜色角色、文案或视觉概念。

### 验收信号

- measurement 显示所有最终文字组均为 `inside`；
- 远距离缩略图中顶部、红色中段、底部停止语仍构成清楚层级；
- 顶部与底部明显服从同一两列骨架；
- 项目所有者不再首先描述画面为“不协调”；
- 结果仍具有排版物感，而不是普通居中通知。

## 3. Run 记录

### AE-20260729-T6-anchor-measured-revision-M-R1

#### 环境与基线

- 开始/结束时间：2026-07-29 18:06:42 PDT / 2026-07-29 18:24:34 PDT
- Agent：Codex desktop；当前任务不可见精确模型版本
- MCP/capability：Package `0.0.1`；protocol `1.0`；Git `ae13bfd`；
  `rendered-node-measurement-v1`
- Scopes：read、preview、edit；Trusted Local
- Baseline revision：`0`
- Baseline layers：`layer_1`，仅默认 `Output`
- 与预注册的偏离：
  - 第一个 baseline dry-run 遇到上一 turn 的 Chrome session 已断开，返回
    `SESSION_REVOKED`；Trusted Local 重启不需要人类批准。
  - 重启后复用了紧邻本 Session 的升级复查 capability/document 结论，没有在
    baseline 写入前重新调用 `gfx_get_capabilities` 和 `gfx_get_document`；两项
    查询在 revision 2 补录。这不影响 baseline hash、transaction 或 exact render
    证据，但违反标准 Preflight 顺序。

#### Agent 执行前解释与策略

该策略已在上一轮对话中向项目所有者展示，并由项目所有者以 “okay, go ahead”
确认：

- 先确定性恢复 inherited C，验证 exact preview hash；
- 把 `DOG` 与 `PEE` 分为共享列中心的顶部双拍；
- `IS NOT AN` 与 `AMENITY.` 横跨两列，以 painted-bounds center anchor 定位；
- `NOT HERE.` 与 `NOT AGAIN.` 使用同一列中心形成底部呼应；
- 只让 `AMENITY.` 保留轻微波形；
- preview 前测量所有最终 Place 输出；只有意外裁切可以触发一次技术修正；
- 不使用字体更换来假装解决当前 MCP 尚未开放的能力。

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_apply_transaction` | `...baseline-dryrun-V1` | 重建 inherited C；dry-run | `SESSION_REVOKED`；未写入 | 0 | 17 ms |
| 2 | `gfx_apply_transaction` | `...baseline-dryrun-V2` | 相同 baseline；Trusted Local 重启后重试 | dry-run valid | 0 → proposed 1 | 18 ms |
| 3 | `gfx_apply_transaction` | `...baseline-commit-V1` | 提交 inherited C | committed；`transaction_1` | 0 → 1 | 15 ms |
| 4 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 1 | 4 ms |
| 5 | `gfx_await_render` | — | exact ticket | complete；attempt 1 | 1 | 3 ms |
| 6 | `gfx_capture_preview` | — | baseline；1024 bound；PNG + metrics | 819 × 1024；hash 与 S1 完全一致 | 1 | 62 ms |
| 7 | `gfx_measure_rendered_nodes` | — | inherited C 的 5 个 Place 输出 | 5/5 measured inside | 1/attempt 1 | 5 ms |
| 8 | `gfx_apply_transaction` | `...design-dryrun-V1` | 两列 grid、6 个短语、anchors | `INVALID_ARGUMENT`；2 条 Text no-op；未写入 | 1 | 8 ms |
| 9 | `gfx_apply_transaction` | `...design-dryrun-V2` | 删除 no-op 后相同设计计划 | dry-run valid | 1 → proposed 2 | 7 ms |
| 10 | `gfx_apply_transaction` | `...design-commit-V1` | 提交两列 anchor 修订 | committed；`transaction_2` | 1 → 2 | 20 ms |
| 11 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 2 | 2 ms |
| 12 | `gfx_await_render` | — | exact ticket | complete；attempt 1 | 2 | 1 ms |
| 13 | `gfx_measure_rendered_nodes` | — | preview 前测量 6 个最终 Place 输出 | 6/6 measured inside；0 overflow | 2/attempt 1 | 2 ms |
| 14 | `gfx_capture_preview` | — | M revision；1024 bound；PNG + metrics | 819 × 1024 | 2 | 51 ms |
| 15 | `gfx_capture_preview` | — | M revision；256 bound；PNG + metrics | 204 × 256 | 2 | 15 ms |
| 16 | `gfx_get_capabilities` | — | 补录 Place anchors 与 measurement contract | protocol 1.0；feature 可用 | 2 | 8 ms |
| 17 | `gfx_get_document` | — | 补录 current 全图 | 22 nodes；25 edges | 2 | 4 ms |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| inherited C baseline | 1/attempt 1 | 819 × 1024 | `98e5023b73664b376c144f760e756f468784e6f81a042d9051192d268096113a` | `test-results/.../previews/t6-baseline-preview-1.png` |
| M revision large | 2/attempt 1 | 819 × 1024 | `cac3162435c759fa089109ada4391274b3a587df271d3820fd10b2371065d7cc` | `test-results/.../previews/t6-design-v1-preview-large-1.png` |
| M revision thumbnail | 2/attempt 1 | 204 × 256 | `3b9c708df5cbb2337ebe4193df833e5a364374aa970f8848e421a4d6000b3a6a` | perceptual hash `bb3bc84e3f61c0c4` |

Preview 前的 exact-ticket 几何证据：

| 文字组 | Node | Unclipped bounds (x, y, w, h) | Clipping |
| --- | --- | --- | --- |
| `DOG` | `place_1` | 121.39, 93.38, 357.22, 173.25 | inside；0 overflow |
| `PEE` | `place_6` | 601.17, 95.47, 357.66, 169.06 | inside；0 overflow |
| `IS NOT AN` | `place_2` | 343.13, 380.19, 393.75, 59.63 | inside；0 overflow |
| `AMENITY.` | `place_3` | 102.33, 547.53, 875.34, 184.94 | inside；0 overflow |
| `NOT HERE.` | `place_4` | 99.06, 1008.41, 401.88, 63.19 | inside；0 overflow |
| `NOT AGAIN.` | `place_5` | 578.67, 1011.64, 402.66, 56.72 | inside；0 overflow |

#### Agent 两遍评价

需求与硬约束：

- Q0 通过：revision 2 / attempt 1 的 validation、render、measurement 和两张
  preview 对应同一 exact ticket。
- Q1 通过：固定文案分布在 6 个 Text 节点中，标点完整；frame 为 1080 × 1350；
  无资产或模型；所有最终文字节点为 `inside` 且 0 overflow。
- inherited C 的 baseline hash 与 S1 完全一致，证明对照起点没有因升级漂移。
- preview 前无需因裁切执行技术 hard-fix；anchors 已消除旧版的原点猜测。

审美质量：

- 顶部 `DOG` / `PEE` 使用同一列中心，实际 painted width 只相差 0.44 px；底部
  两句通过 78 / 70 的字号得到几乎相同的 402 px 视觉宽度。
- `IS NOT AN` 与 `AMENITY.` 以 painted-bounds center anchor 横跨两列；红字不再
  偏向右侧，波形幅度从 22 降到 16，只保留一次受控破格。
- 底部两句由前后两行改为同一停止拍，和顶部形成可解释的两列呼应；当前画面只有
  一套空间骨架，而不是三套互相竞争的轴线。
- 缩略图仍先读到 `DOG PEE`，其次是红色 `AMENITY.`, 最后是底部命令句。
- `AMENITY.` 与底部之间的较大留白现在是一处统一的语义停顿；底部以下仍保留较多
  主动留白。它提高秩序感，但是否显得过于稳妥或静态需要项目所有者判断。
- default font 的家族角色没有改变；本版改善来自字号、视觉宽度、anchor 和空间
  节奏，不能证明字体 palette 问题已经解决。
#### 人类反馈

继承并驱动本 Run 的原始反馈：

> 嗯，感觉这次好了一些。
> 但是还是感觉画面没有那么协调，可能从位置，字体，对称 等方面。你觉得呢？

第一张 M preview 后最多再记录一轮：

> 我感觉我其实会更喜欢M. 其中不协调的点仅仅剩中间的 "Amenity.", 其原因是由于
> 句号 其 视觉中心稍微偏左。
>
> 我觉得接下来要改，我会想提升画面的创意性。现在的画面我感觉虽然好一些，但是
> 仍然没有感觉到很 “创意”，“酷”，“独到的Graphic Design审美”。
>
> What do you think? 和我聊聊

结构化解释：

- 保留：M 的整体空间骨架；项目所有者在 inherited C 与 M 之间更喜欢 M。
- 当前残留问题：中间 `AMENITY.` 的光学中心稍微偏左。
- 原因：painted bounds 把句号贡献的右侧几何宽度计入居中，但句号的视觉重量远低于
  大写字母；因此几何中心正确，不等于字母主体的光学中心正确。
- 新的最高优先级：“创意”“酷”“独到的 Graphic Design 审美”。
- 协议判断：这是概念生成目标，而不是本 Session 预注册的协调性修订；不在看到
  M 后改写问题或继续追加 revision，另建新 Session 探索。

#### 修订及保留关系

- 保留：酸性背景、近黑主字、橙红 `AMENITY.`、固定文案、纯文字与海报优先感。
- 改变：把 `DOG PEE` 拆成两个列锚点；底部两句合成同一水平停止拍；全部短语改用
  painted-bounds anchors；底部字号按实测宽度配平；红字波形幅度 22 → 16。
- 原因：只解决已确认的最高优先级“不协调”，不引入新概念或装饰。

#### 最终结果

- Final revision：`2` / render attempt `1`
- 停止原因：项目所有者在 revealed comparison 中更喜欢 M，原定协调性修订已达到；
  “创意、酷、独到”是新的概念探索目标，超出本 Session 的固定问题与 Agent 自由度。
- Tool calls：17
- Transactions：2 次 committed（baseline + M revision）；2 次 successful dry-run；
  另有 1 次 session-revoked dry-run 和 1 次 no-op invalid dry-run。
- Feedback rounds：1 次首张 M preview 后的人类评价；没有据此追加设计写入。
- Failures/conflicts/reverts/retries：1 次 `SESSION_REVOKED` 后重启重试；1 次
  `INVALID_ARGUMENT` no-op 后删除冗余 patch 重试；0 conflicts；0 reverts；0 次
  preview 后技术 hard-fix。
- 总时长：17 分 52 秒

## 4. 评价

### Revealed 成对偏好

| 比较 | 选择 | 置信度 | 原因 |
| --- | --- | --- | --- |
| inherited C vs M revision | M revision | 未单独报告 | 整体协调性明显改善；剩余不协调只指向 `AMENITY.` 因句号造成的光学偏心 |

### 维度评分

| Run | 需求符合度 | 信息层级 | 构图与空间 | 字体与文字 | 色彩 | 一致性 | 独特性 | 完成度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| inherited C | 5 | 4 | 3 | 3 | 5 | 3 | 3 | 4 |
| M-R1 | 5 | 5 | 4 | 4 | 5 | 5 | 3 | 5 |

每个分数的可观察证据：

- 两版均完整保留固定文案、frame、纯文字和 notice 功能，需求符合度相同。
- M 的顶部与底部共享两列中心，三层阅读顺序在缩略图中更明确，因此信息层级、
  构图与一致性提升。
- M 的字宽配平和 anchor 关系更完整，但 `AMENITY.` 的句号暴露出 painted-bounds
  居中无法解决的光学字重问题，因此字体与文字、构图均不评为 5。
- 色彩角色未改变，均保持酸性背景、近黑主字和橙红语义重音。
- 人类明确认为 M 仍未达到“创意、酷、独到”，因此独特性不因整齐度提升而加分。
- M 的所有关键文字均在首次展示前通过 exact-ticket measurement，且不需要
  preview 后 hard-fix；在本 Session 固定目标内完成度为 5。

### Agent 与人类评价的分歧

- Agent 在展示前已经判断 M “可能过于稳妥或静态”；人类反馈确认了这一质量上限，
  并把它更准确地命名为缺少“创意、酷、独到”。
- Agent 依据 rendered bounds 判断 `AMENITY.` 几何居中；人类识别到句号视觉重量
  很低，导致字母主体看起来偏左。这里人类的光学判断比几何测量更能解释剩余问题。

## 5. 偏离、失败与混杂因素

- Trusted Local 消除了重新批准，但当前 Codex 宿主仍会在 turn 边界回收 Chrome
  companion；因此“授权摩擦”已改善，“宿主会话连续性”尚未完全解决。
- 标准 Preflight 查询在 session restart 后没有按顺序重做，已在 revision 2 补录。
- 第一个设计 dry-run 含两个合法但无变化的 Text patch，被 command boundary
  正确拒绝；删除 no-op 后未改变设计计划。

## 6. 结论

### 本 Session 支持的结论

- 在这个作品上，painted-bounds anchors 与 preview 前 exact-ticket measurement
  能消除旧版的定位原点猜测和意外裁切：6/6 文字组首次展示前均为 `inside`，且
  没有 post-preview hard-fix。
- 项目所有者更喜欢使用共同列中心、视觉宽度配平和统一轴线的 M，支持“协调性”
  可以被翻译为可测量空间关系的判断。
- Trusted Local 在 companion 重启时消除了再次人工批准。

### 本 Session 不能支持的结论

- 不能把人类偏好单独归因于 anchors 或 measurement，因为 MCP 能力和设计策略同时
  改变，且只有一个候选、一个评价者。
- 不能证明几何测量能够保证光学居中；`AMENITY.` 的句号正是反例。
- 不能证明协调性提升会带来创意性、酷感或独特性；人类评价明确区分了二者。
- 不能评价字体 palette 对质量的提升，因为 Agent 仍不能枚举或写入字体。

### 对 Brief 写法的启示

- “协调”可继续拆成共同轴线、成对视觉宽度、垂直节拍和主动留白。
- “创意、酷、独到”不能只写成抽象形容词；下一 Brief 应要求一个由内容语义产生、
  在缩略图中可识别且只属于这句话的核心形式规则，并说明允许何种受控破格。
- 标点需要被视为有独立视觉重量的设计材料，而不只是文字字符串的一部分。

### 对 Agent 工作流的启示

- 定向 refinement 应在已确认问题解决后停止。看到结果后新增的概念目标应进入新的
  探索 Session，避免把一次微调无限扩张并事后改写研究问题。
- measurement 适合做渲染、裁切和几何关系硬门槛；缩略图与人类光学判断仍是审美
  检查的必要第二层。

### 对 MCP/API 设计的启示

- rendered-node bounds 显著改善了定位与边界可靠性，但 API 不能把包围盒中心误称为
  视觉中心。标点、非均匀字形与 warp 后内容仍需要 optical compensation。
- 后续可考虑暴露 glyph/run 级 bounds、排除尾部标点的测量选项，或允许把标点拆为
  可独立锚定的节点；这些都只提供控制，不替代审美判断。
- Trusted Local 已减少批准摩擦，但宿主 turn 边界仍可能回收 companion，会话连续性
  仍需改进。

### 下一步实验

- 先与项目所有者确认更具体的“酷”与“独到”方向，再预注册新的 T5 概念探索
  Session。优先检验“严格秩序中只有一次语义化违规”的形式规则，并把句号的光学
  问题转化为概念材料，而不是只做像素级右移。

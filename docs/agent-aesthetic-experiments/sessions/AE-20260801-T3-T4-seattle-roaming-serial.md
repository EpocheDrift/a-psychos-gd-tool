# AE-20260801-T3-T4-seattle-roaming-serial — “漫游西雅图”系列海报系统原型

状态：**Complete — 人类选择 B；系列文案变化原则已澄清，四张迁移 Run 尚未开始**

Spec 版本：**0.1.0**

Playbook 版本：**0.1.0**

日期：**2026-08-01**

负责人：**项目所有者 × Codex**

## 1. 预注册

### 研究问题

- RQ1：当照片、文案、字体与颜色固定时，`Quiet Index` 与 `Roaming Edges`
  两种图文关系中，哪一种更符合项目所有者“不解释、只存在和陈列”的个人 Instagram
  profile 气质？
- RQ2：哪一种系统既能保留照片的质感与构图，又能形成足够明确、独到的 serial-poster
  识别？
- RQ3：代表性单张上的排版关系是否具有扩展到另外三张不同阴影/留白结构照片的潜力？

### 假设

- H1：`Quiet Index` 会更完整地保留摄影观看，但可能因文字太克制而缺少系列记忆点。
- H2：`Roaming Edges` 会更直接地把“漫游”变成文字沿画框移动的排版行为，因此独特性和
  系列潜力更高，但也更容易和照片争夺视觉主导。
- H3：先在同一张照片上比较两套语法，再扩展胜出系统，比直接各自设计四张更能区分
  “系统有效”与“单张偶然好看”。

### 任务族

- 主要：**T3 图像主导的编辑设计**；
- 后续迁移：**T4 同一视觉系统的系列变体**。

本 Session 的首轮只做 T3 单张 A/B 原型；胜出系统扩展到四张属于后续 Run，不在看见
首轮结果后改变本轮问题。

### 固定任务与完整文案

- 主题：漫游西雅图；城市移动方式为公交车 + 步行；路线语境为 Capitol Hill 到
  Pike Place Market；
- 固定主文案：`ROAMING SEATTLE`；
- 固定索引文案：
  - `CAPITOL HILL → PIKE PLACE`
  - `BUS + WALK`
  - `JUL 2026`
  - `01 / 04`
- 首轮固定代表照片：`private-photo-F1`（原始素材不纳入仓库）；
- source SHA-256：`[公开仓库已脱敏；保留于私有封存证据]`；
- source 形态：约 3:4 竖幅；精确像素尺寸与 byte length 仅保留于私有封存证据；
- frame：1080 × 1440；
- 原图完整映射到等比例 frame；不裁切、不调色、不降噪、不锐化、不做图像效果；
- 文字统一使用 `font=default`、暖灰白 `#E9E7DE`；不增加图标、色块、地图或说明段落。

### 条件

**A — Quiet Index**

- 文字是边缘档案标签，不成为照片标题牌；
- 主标题和 metadata 都使用小到中等字号、低密度层级；
- 主要放在照片已有暗部/角落；
- 以精确对齐、间距和位置关系制造完成度；
- 允许主标题一行或两行，但不得侵入中央天空主视区。

**B — Roaming Edges**

- 文字本身沿画框边缘移动，成为“漫游”的排版行为；
- `ROAMING` / `SEATTLE` 可分离到不同边或不同高度，形成更强的空间张力；
- metadata 保持小字号，作为路线残片；
- 允许更明显的字号反差与边缘裁切感，但所有文字实际绘制边界必须位于 frame 内；
- 不得遮挡中央天空通道或改变照片。

### 控制变量

| 变量 | 固定值 |
| --- | --- |
| Agent 产品/模型/版本 | Codex desktop；当前任务不可见精确模型版本 |
| MCP Companion/capability 版本 | package `0.0.1`；protocol `1.0`；Git `ae13bfd`；13 tools；measurement v1 |
| 浏览器/操作系统 | Chrome `151.0.7922.72`；macOS `26.5.2` (`25F84`) |
| Frame | 1080 × 1440 |
| 字体条件 | `font=default`；A/B 相同 |
| 资产 | 上述单张 JPEG；SHA 固定；A/B 相同 |
| 图像处理 | 无；Image 等比例满版；A/B 相同 |
| 文案 | 上述五条固定字符串；A/B 相同 |
| 色彩 | 原图 + `#E9E7DE` 文字；A/B 相同 |
| Scopes | read、preview、edit、assets；Trusted Local |
| 初始文档 | 独立 Companion 的 revision 0 空白项目；若不是则停止 |
| 候选数 | 2 |
| 反馈轮数 | 首轮 0；人类反馈后另记 Run，最多 2 轮 |
| 时间预算 | 无硬上限；记录实际时间与工具耗时 |

### 主要结果

由项目所有者对匿名 A/B 作成对选择，并给出：

1. 哪张更像其 Instagram profile 中会自然存在的东西；
2. 哪张更好地保留了照片本身；
3. 哪张更具有“漫游西雅图”的系列潜力；
4. 选择置信度与可观察原因。

### 次要结果

- Agent 在需求符合度、图文关系、构图与空间、字体、系列一致性、独特性和完成度上的
  两遍评价；
- 所有关键文字 `Place.out` 是否 inside；
- 两个候选是否都通过 0-error validation 与 exact-ticket preview；
- 将首轮系统扩展到另三张时预期需要保留/改变的关系。

### 重复次数

首轮每个条件各 1 个候选。不得在看到 preview 后为某一条件增加额外候选以提高胜率。

### 停止规则

- 初始文档非 revision 0 空白项目时停止，不覆盖已有作品；
- source hash、尺寸或 MIME 不符时停止；
- asset upload、dry-run 或 commit 无效时可修复 request envelope，但不得改变固定图片、
  文案和条件定义；
- 意外越界、缺字、未渲染、连接错误属于硬约束故障，可做一次最小修复并记录；
- 两个候选均通过 validation、measurement 和 exact preview 后立即停止，等待人类比较；
- 看见结果后的审美修改不属于首轮，必须作为反馈 Run 记录。

### 盲评方式

- 交付时只显示 `A` / `B` 与相同尺寸 preview，不先公布系统名称；
- 预注册映射固定为 A = Quiet Index，B = Roaming Edges；
- 用户已经知道存在两种方向，因此这是低强度标签盲测，不宣称严格盲评。

### 已知混杂因素

- 只有一张代表照片参与首轮，不能直接证明四张系列均适用；
- 两条件同时改变层级尺度和空间行为，因此主要比较的是完整 art direction system，
  不是单一位置参数；
- default font 限制可能使档案感与强边缘感共享同一字形语言；
- 3:4 draft frame 用于保留代表照片比例；Instagram 最终发布规格与 carousel 统一比例
  属于后续生产约束，本轮不评价；
- 用户与 Agent 已讨论方向名称，会存在预期偏差。

> 完成本节后再进行第一笔 MCP 设计写入。开始时间：
> **2026-08-01 17:14:05 PDT**

## 2. Brief

### 目标

把四张在西雅图公交/步行移动中拍摄的照片发展成一个 serial poster。设计不是旅游宣传，
也不解释行程；它像个人 profile 陈列柜中的感知、生活、记忆和时刻切片。

### 输出与场景

- 首轮输出：同一张照片上的 A/B 两张 1080 × 1440 原型；
- 最终场景：Instagram 个人 profile / carousel；
- 后续目标：将胜出系统扩展为四张相互关联但不机械复制的系列。

### 必须内容

- 保留照片完整质感与构图；
- 文字只作为第二层视觉结构；
- 固定英文文案完整出现；
- 路线语境使用正确拼写 `Capitol Hill` 与 `Pike Place`；
- 中央天空通道保持主要视觉空间。

### 信息层级

1. 摄影画面与城市空间；
2. `ROAMING SEATTLE`；
3. 路线、移动方式、时间、系列编号。

### 审美意图

- 低曝光、冷蓝天空、颗粒与巨大暗面的私人观察；
- 安静但不无聊，编辑性但不 corporate；
- 文字像索引、路线残片或画框中的移动物，不像 caption；
- 成功意味着“放进 profile 会自然存在”，不是“信息解释得最清楚”。

### 视觉关系

- 摄影始终是视觉底层和语义主体；
- 文字锚定照片已有阴影、建筑边缘和画框，不制造无来源的中央版心；
- A 用克制尺度与精确边距建立张力；
- B 用标题分离和边缘迁移建立张力；
- 小字在两条件中都承担档案/路线索引角色。

### 视觉参考及参考原因

不引入外部 moodboard。四张原始照片自身的暗部、天空、建筑几何与公交窗口关系是本轮
唯一视觉参考，避免套用现成“Seattle travel poster”风格。

### 反例与避免项

- 旅游广告、城市品牌、地图 pin、景点清单；
- 大段说明“我从哪里去哪里”；
- 为了统一而对四张机械复制同一模板；
- 过多色块、图标、装饰线或无语义 UI 元素；
- 文字过亮、过满或压住天空；
- 把低曝光、颗粒和阴影误当成需要修复的问题。

### 必须保留

- source 像素与完整画面；
- 天空形成的中央纵向通道；
- 左右建筑暗面对中央亮部的夹持关系；
- 原图冷蓝/黑灰色调；
- 无解释主体的陈列感。

### Agent 自由度

在各条件预注册范围内，可决定具体字号、字距效果、断行、四角/上下边位置和 alignment；
不得改变照片、固定文案、字体、文字颜色或条件的核心空间逻辑。

### 验收信号

- A/B 在缩略图中都首先被识别为同一张摄影作品，而非文字海报；
- 文字能在暗部清楚存在，但不遮挡中央天空；
- A 明显表现“quiet archival index”；B 明显表现“type roaming around edges”；
- 两张不是同一模板的轻微位移；
- 0 errors / 0 warnings；关键文字全部 inside；
- 产生可审计 transaction、preview 与 source/hash 证据。

## 3. Run 记录

### AE-20260801-T3-T4-seattle-roaming-serial-AB-R1

#### 环境与基线

- 开始/结束时间：2026-08-01 17:14:05 PDT / 2026-08-01 17:20:23 PDT
- Agent：Codex desktop；当前任务不可见精确模型版本
- MCP/capability：package `0.0.1`；protocol `1.0`；Git `ae13bfd`；13 tools；
  `rendered-node-measurement-v1`
- Scopes：read、preview、edit、assets；Trusted Local
- Baseline revision：`0`
- Baseline layers：2304 × 3456；`layer_1` 只含默认 `Output`
- 与预注册的偏离：两次首次只读调用误带旧版不接受的 `requestId`，均以
  `INVALID_ARGUMENT` fail-closed；去掉 envelope 后重试成功。文档 revision 始终为 0，
  未发生设计写入，不改变实验条件。

#### Agent 执行前解释与策略

- 用城市峡谷照片作为代表图，因为它同时具备中央天空、左右暗面和可用于排版的边缘；
- A/B 共享 source asset、图像节点参数、文字、字体与颜色；
- 每个候选使用独立图层，先验证 A，再只切换 visibility 验证 B；
- 不在首轮 preview 后进行审美调参；只允许修复可测硬约束故障；
- 保存完整 transaction 和 exact-ticket previews，避免只有最终截图而无法重放。

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_get_capabilities` | `seattle-preflight-capabilities` | 误带 `requestId` | `INVALID_ARGUMENT`；无写入 | 0 | 2 ms |
| 2 | `gfx_get_document` | `seattle-preflight-document` | 误带 `requestId` | `INVALID_ARGUMENT`；无写入 | 0 | 3 ms |
| 3 | `gfx_get_capabilities` | `seattle-preflight-capabilities-v2` | sockets、params、traits | 成功；assets 可用 | 0 | 11 ms |
| 4 | `gfx_get_document` | `seattle-preflight-document-v2` | 完整空白文档 | 成功 | 0 | 3 ms |
| 5 | `gfx_put_asset` | `…-asset-begin-V1` | JPEG；精确 byte length / SHA 私有封存 | upload staged | 0 | 4 ms |
| 6 | `gfx_put_asset` | `…-asset-chunk-0-V1` | bounded chunk 1 | 成功 | 0 | 55 ms |
| 7 | `gfx_put_asset` | `…-asset-chunk-1-V1` | bounded chunk 2 | 成功 | 0 | 57 ms |
| 8 | `gfx_put_asset` | `…-asset-chunk-2-V1` | final bounded chunk | upload complete | 0 | 7 ms |
| 9 | `gfx_put_asset` | `…-asset-finalize-V1` | expected revision 0 | `transaction_1`；asset durable | 0→1 | 75 ms |
| 10 | `gfx_apply_transaction` | `…-design-dry-run-V1` | 99 commands；A/B 同时创建 | 成功；proposed revision 2 | 1 | 19 ms |
| 11 | `gfx_apply_transaction` | `…-design-commit-V1` | 同一 99 commands | `transaction_2` 成功 | 1→2 | 15 ms |
| 12 | `gfx_validate_document` | `seattle-A-validate-r2` | A visible；renderable | 0 errors / 0 warnings | 2 | 4 ms |
| 13 | `gfx_await_render` | `seattle-A-await-r2` | exact ticket | complete | 2 / attempt 1 | 2 ms |
| 14 | `gfx_measure_rendered_nodes` | `seattle-A-measure-r2` | A 的 6 个 `Place.out` | 6/6 inside | 2 / attempt 1 | 3 ms |
| 15 | `gfx_capture_preview` | `seattle-A-preview-large-r2` | 1024 bound；PNG + metrics | 768×1024 | 2 / attempt 1 | 81 ms |
| 16 | `gfx_capture_preview` | `seattle-A-preview-thumb-r2` | 256 bound；PNG + metrics | 192×256 | 2 / attempt 1 | 10 ms |
| 17 | `gfx_apply_transaction` | `…-switch-B-dry-run-V1` | A hidden / B visible | 成功；proposed revision 3 | 2 | 7 ms |
| 18 | `gfx_apply_transaction` | `…-switch-B-commit-V1` | 只切换 visibility | `transaction_3` 成功 | 2→3 | 11 ms |
| 19 | `gfx_validate_document` | `seattle-B-validate-r3` | B visible；renderable | 0 errors / 0 warnings | 3 | 3 ms |
| 20 | `gfx_await_render` | `seattle-B-await-r3` | exact ticket | complete | 3 / attempt 1 | 1 ms |
| 21 | `gfx_measure_rendered_nodes` | `seattle-B-measure-r3` | B 的 6 个 `Place.out` | 6/6 inside | 3 / attempt 1 | 1 ms |
| 22 | `gfx_capture_preview` | `seattle-B-preview-large-r3` | 1024 bound；PNG + metrics | 768×1024 | 3 / attempt 1 | 71 ms |
| 23 | `gfx_capture_preview` | `seattle-B-preview-thumb-r3` | 256 bound；PNG + metrics | 192×256 | 3 / attempt 1 | 9 ms |
| 24 | `gfx_get_document` | `seattle-final-document` | frame、layers、visibility | A hidden / B visible | 3 | 2 ms |
| 25 | `gfx_get_asset_metadata` | `seattle-final-asset` | asset metadata 与引用 | exact SHA；2 references | 3 | 2 ms |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| A large | 2 / attempt 1 | 768 × 1024 | content `af31ba81d54ed43140bc0b5b0f9cddbcea86b536a6b92523c4670943d31c00ab`；RGBA `951ecb4e7c7a1178bec58c0861e3742f12244ff0210c26a1e8aa39096e5a3500` | `previews/seattle-A-preview-large-r2-1.png` |
| A thumb | 2 / attempt 1 | 192 × 256 | content `535c4da4eef0c894ee1e5cf214a0d93ea53a1bd68872bb22406193e2c7c58fb0`；RGBA `f3daec439dbff4ef5d8596f9d2bdb10d1f976cca1861abe0cbd7477a05eac286` | `previews/seattle-A-preview-thumb-r2-1.png` |
| B large | 3 / attempt 1 | 768 × 1024 | content `1d910028048518f74426a3564dde830d59ef83f03790886a059d3eabf6a564ab`；RGBA `5b28757fe7528019e9aa2bcc5bfad49107f908a69d56d53d23d977b3038a67da` | `previews/seattle-B-preview-large-r3-1.png` |
| B thumb | 3 / attempt 1 | 192 × 256 | content `fe80b159a0d99b069ea1e541b59fe51d962b28afb253c9a748ec0e7d3f06b687`；RGBA `1e4483e9edb5aee4ef79834062226ecad857ccfc19bf853521225f67bea9293f` | `previews/seattle-B-preview-thumb-r3-1.png` |

#### Agent 两遍评价

需求与硬约束：

- A/B 使用同一 verified asset；约 3:4、JPEG 与私有封存的 source identity 全部匹配；
- frame 为 1080 × 1440，Image `contain`，无图像处理节点；
- 两版五组固定语义通过六个 Text 节点完整出现；字体与 `#E9E7DE` 相同；
- 两版均 0 errors / 0 warnings，6/6 文字 bounds inside；
- A/B 的文字均锚定暗部，未占用中央天空通道；
- 未在看见 preview 后做审美修订。

审美质量：

- A：照片保持绝对主导；左上标题、四角 metadata 把画面变成安静的个人档案索引。
  上左与下右形成稳定对角平衡，中央天空完整。缩略图中主标题仍可辨，小字主动退后。
  风险是四角索引接近成熟的 editorial/contact-sheet 语言，独特性主要来自照片而非排版。
- B：`ROAMING` 与 `SEATTLE` 分居左上/右下，并准确贴合两侧暗建筑，文字本身完成一次
  穿越画框的动作；中央亮部因此被更明确地“夹”出来。缩略图仍有强识别，适合建立
  serial rhythm。风险是标题存在感明显提高，个人陈列感可能被读成更主动的 poster design；
  中段/角落 metadata 的必要性仍需人类判断。

#### 人类反馈

原样记录：

> 我会选B. 我感觉B所选用的字体和排版大小更符合我想要的，我不想要太尖锐，
> 我想B的稍微圆润的标题更符合我的感觉。然后我感觉可以再优化的是文字的内容，
> 我可能会想文字内容更"brutalist"一点。What u think?

结构化保留/改变：

```text
保留：B 的标题尺度、粗字重、左上→右下的边缘迁移、较圆润/钝的字形感
改变：文字内容；需要比当前路线索引更 brutalist
原因：B 更符合个人感觉，不希望视觉语言太尖锐
本轮最高优先级：先定义“brutalist 文案”的语义性格，再改文案
允许 Agent 自由处理的部分：提出不同文案语气方案；尚未授权改变照片或 B 的核心排版关系
```

后续意图更正（发生在任何新设计写入之前）：

> 算了，内容上我们还是保持之前那样吧。只是我想每张图的文字都不太一样，避免过于单调，
> 这可能其实是想内容上也有一定的由变化带来的“刺激”。 你有需要补充/更多问题可以问我。

当前有效解释：

```text
保留：B 的标题尺度、粗字重、较圆润/钝的字形感、边缘迁移，以及原版英文文案的编辑性/路线索引语气
撤回：不再把“文案更 brutalist”作为下一轮目标；此前建议未进入 MCP 写入
改变：四张不机械重复同一组字符串；每张文案应与各自照片、位置或移动瞬间发生联系
原因：系列需要通过内容变化产生刺激，同时避免四张过于单调
本轮最高优先级：建立“固定视觉语法 + 可变文案内容”的系列规则
允许 Agent 自由处理的部分：先提出四张文案架构与变化幅度；核心排版关系和照片仍保持不变
```

#### 修订及保留关系

首轮无审美修订；如发生硬约束修复，逐项记录。

#### 最终结果

- Final revision：`3`；A hidden / B visible
- 停止原因：两个预注册候选均通过 exact render、validation、measurement 和 preview；
  按停止规则等待人类 A/B 判断
- Tool calls：25；MCP 报告耗时合计约 458 ms
- Transactions：2 次 dry-run；3 次 commit（asset、design、visibility）；0 revert
- Feedback rounds：0
- Failures/conflicts/reverts/retries：2 schema-envelope failures / 0 conflicts / 0 reverts /
  2 corrected read-only retries
- 总时长：6 分 18 秒（含新 Companion、asset upload、双候选实现、验证与记录）

## 4. 评价

### 盲测成对偏好

| 比较 | 选择 | 置信度 | 原因 |
| --- | --- | --- | --- |
| A vs B | B | 未量化 | B 的字号/字重呈现出更圆润、不尖锐的标题性格；排版尺度更符合项目所有者。首轮反馈中的“更 brutalist”随后被撤回，当前目标改为四张文案各有变化。 |

### 维度评分

| Run | 需求符合度 | 信息层级 | 构图与空间 | 字体与文字 | 色彩 | 一致性 | 独特性 | 完成度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 5 | 4 | 4 | 4 | 5 | 4 | 3 | 4 |
| B | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 4 |

每个分数的可观察证据：

- 需求符合度 5：两版均保留 source 与中央天空，文字只进入暗部并使用固定内容；
- A 层级/空间 4：清晰、安静且平衡，但缩略图下大部分 metadata 消失，系列动作偏弱；
- B 层级/空间 5：标题的左上→右下阅读路径和建筑夹持关系都清晰，缩略图仍成立；
- 字体与文字 4：default mono 与索引语义一致，尺度有控制；缺少字距与通用静态旋转能力，
  尚未检验跨四张变化；
- 色彩 5：只使用原图与统一暖灰白，暗部对比明确且无装饰性色彩；
- 一致性 4：单张内部关系完整，但未完成四张迁移验证；
- A 独特性 3：完成度高但接近已知 editorial index 语法；
- B 独特性 4：边缘迁移直接来自“漫游”，但“大字在边缘”仍需靠四张连续变化证明
  不是表面风格；
- 完成度 4：边界、对齐、渲染均可靠；最终平台比例、carousel 与四张系统尚未完成。

### Agent 与人类评价的分歧

方向选择无实质分歧：Agent 预判 B 的边缘迁移与缩略图识别更强，人类选择 B。新增的人类
信号是“不要太尖锐、标题应稍微圆润”。A/B 实际使用同一个 default font；因此这里被选择的
不是另一个字体文件，而是大字号、900 weight 和更宽松空间共同造成的钝圆字形感。下一轮必须
保留这种感知结果，不能把“brutalist”误译成更尖、更硬或更具攻击性的字体。

## 5. 偏离、失败与混杂因素

- 除两次错误 read envelope 外无实验偏离；错误均在 revision 0 fail-closed，未污染设计。
- 单个候选有 20 个自建节点和 25 条连接；两个候选加 frame/layer 操作正好使用 99/100
  transaction commands。当前 API 能表达结果，但多标签 image+type composition 接近单次事务上限。
- `persistenceStatus=durable` 表示当前临时浏览器项目的工作保存成功；仍不等于 MCP 可导出的
  portable project file。

## 6. 结论

### 本 Session 支持的结论

- 技术上支持：同一 verified photo asset 上可以可靠生成两种明显不同、非浅表位移的图文系统；
- Agent 观察支持：A 更强调私人档案与摄影保留，B 更强调可记忆的 serial-poster 动作；
- 人类选择 B，说明在这张代表照片上，较大、较重、较钝圆的边缘标题与其 profile 感觉更匹配；
- 首轮对 brutalist 文案的讨论没有进入设计写入，随后被项目所有者撤回；当前有效方向是保留
  原版编辑性/路线索引语气，通过四张之间的文案变化而非语言攻击性增加刺激。

### 本 Session 不能支持的结论

- 不能从单张原型推断四张迁移后仍一致；
- 不能从 Agent 分数宣布 B 是最终胜者；
- 不能从 3:4 preview 推断最终 Instagram carousel 的裁切/缩略图表现；
- 不能评价文字语义密度是否刚好，直到项目所有者实际观看。

### 对 Brief 写法的启示

“不解释、只陈列”仍可通过固定信息层级变成可执行约束：摄影第一、标题第二、路线索引第三；
同时把“漫游”写成空间行为，比只给抽象风格词更容易产生可比较候选。

### 对 Agent 工作流的启示

先固定照片和内容再比较完整系统，有效隔离了用户对“quiet archive”与“moving edge type”的
偏好。下一轮应保留人类明确选择的关系，只把系统迁移到另外三张，而不是重新发明四张。

### 对 MCP/API 设计的启示

- 资产分块上传、content addressing、引用检查和 exact preview 工作可靠；
- 多条文字覆盖需要每条 Text→Grid→Place，再串联 Composite，A/B 合计几乎耗尽 100-command
  上限。若产品要支持 serial editorial layout，值得增加 group/stack、通用 transform、一次组合
  多个 elements 或更高层的 bounded composition primitive；
- Text 缺少 Agent 可写 letter spacing 和通用静态 rotation，限制了边缘排版的表达，但本轮没有
  为追求效果绕过 capability；
- 仍缺少 Agent 可调用的 portable project save/export。

### 下一步实验

另建 T4 迁移 Session，把胜出的 B 系统扩展到四张；不再比较 brutalist 文案语气。新 Session
应在写入前固定以下边界：

- 不变：照片原始质感、B 的大标题尺度/字重/圆钝感、文字沿边缘移动、暖灰白文字、摄影优先；
- 可变：每张主标题、路线/移动/时间残片，以及文字落在哪些由照片提供的暗部或边缘；
- 系列锚点：至少保留 `SEATTLE`、日期或序号中的一项跨四张重复，具体项目待项目所有者确认；
- 主要观察：内容变化能否提供刺激，同时四张仍被识别为同一系列，而非四张独立海报；
- 避免：四张机械复制同一句话、为变化而使用无来源的假坐标/假 UI、让文字压过照片。

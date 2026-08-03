# AE-20260731-T5-two-kinds-of-cool — 两种“酷”的概念探索

状态：**Complete — N/U 均达到当前 alignment 与 aesthetics 阈值；不强制选出单一胜者**

Spec 版本：**0.1.0**

日期：**2026-07-31**

负责人：**项目所有者 × Codex**

## 1. 预注册

### 研究问题

- RQ1：在 M 已经解决基本协调性的前提下，哪一种完整 art direction 更能让同一张
  纯文字 notice 被项目所有者感知为“创意、酷、独到”：受控破格，还是猛烈的地下
  排版？
- RQ2：把抽象的“酷”拆成两组可观察视觉关系，是否比继续对 M 做无方向微调更有助于
  人类表达偏好？
- RQ3：MCP 能否在同一笔原子设计事务中确定性建立两个候选，并在展示前分别通过
  exact-ticket validation、measurement 和 preview？

### 假设

- H1：N 的单一语义化破格会保留 M 的秩序与完成度，并提高独特性；风险是动作过小，
  仍显得安全。
- H2：U 的碰撞、旋转、尺度压迫与有意边缘张力会增强第一眼冲击；风险是 notice
  清晰度下降或变成泛化的“地下海报”风格。
- H3：两版并排评价会让项目所有者把“酷”进一步描述为关系与取舍，而不只使用抽象
  形容词。

### 任务族

**T5 — 模糊或开放式艺术指导**

### 固定任务与完整文案

- frame：1080 × 1350；
- 固定英文文案：`DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`；
- 纯文字、纯排版，不使用图片、图标或模型；
- 使用场景：公寓电梯或楼道附近的 A4 尺寸 notice；
- 语气：直接、稍微夸张、荒诞幽默，不辱骂、不威胁；
- 两版固定颜色角色：酸性黄背景 `#EFFF38`、近黑主字 `#111111`、橙红强调
  `#F0442E`；
- 两版使用相同 default font capability；
- M 是已知视觉起点与经验，不作为本次第三个候选。

### 条件

**N — Controlled breach / 冷静秩序中的一次违规**

- 继承 M 的可信两列秩序、清楚层级和主动留白；
- `AMENITY` 的字母主体光学居中，不使用泛化的波形效果；
- 句号必须拆成独立排版对象，并成为全画面唯一明显偏离基线或网格的元素；
- 其他所有文字严格服从共同轴线；破格必须能被解释为反复违规的“事件”，但不得
  变成尿滴图标。

**U — Brutal underground / 粗暴、地下、第一眼猛烈**

- 使用明显的尺度压迫、斜向碰撞、字块贴边和不对称重心；
- 允许有意接近画幅边缘，但固定文案的任何字形不得被意外裁切；
- `DOG PEE` 应成为第一眼不可回避的冲击，`AMENITY.` 作为橙红色讽刺性冲突；
- 仍须形成一套可解释的节奏，不得只随机旋转、随机 warp 或堆叠效果。

两版的节点与参数必须在看到任一候选 preview 前由同一笔设计 transaction 固定。
后续 transaction 只可切换 layer visibility 或进行 measurement 发现的单次技术边界
修正，不得先看 N 再重新设计 U。

### 控制变量

| 变量 | 固定值 |
| --- | --- |
| Agent 产品/模型/版本 | Codex desktop；当前任务不可见精确模型版本 |
| MCP Companion/capability 版本 | Package `0.0.1`；protocol `1.0`；Git `ae13bfd`；实际 capability 以 preflight 补录 |
| 浏览器/操作系统 | Google Chrome `151.0.7922.72`；macOS `26.5.2` (`25F84`) |
| Frame | 1080 × 1350 |
| 字体条件 | `font=default`；两版相同 |
| 资产 | 无 |
| Scopes | `read`、`preview`、`edit`；Trusted Local |
| 初始文档 | 新 Companion session revision `0`；2304 × 3456；`layer_1` 仅含默认 `Output` |
| 候选数 | 2（N、U） |
| 反馈轮数 | 成对展示后最多 1 轮人类评价；本 Session 不据此混合或精修 |
| 时间预算 | 无硬上限；记录实际时间 |

### 主要结果

1. 项目所有者对 N 与 U 的成对偏好、置信度和开放式理由；
2. 哪一版更接近“创意、酷、独到”，以及哪种形式关系产生该判断；
3. 两版在需求符合度、信息层级、构图与空间、字体与文字、一致性、独特性和完成度
   的 1–5 分与可观察证据；
4. 两版首次展示前是否均通过 Q0–Q1 和 rendered-node bounds 硬门槛。

### 次要结果

- 缩略图中第一眼层级与大图中光学字重判断是否一致；
- 独立标点是否既修复 `AMENITY.` 的光学中心，又提供可记忆形式；
- U 的有意边缘张力能否与意外裁切可靠区分；
- 两候选同事务建立、layer visibility 切换的调用与 revision 成本。

### 重复次数

每个条件 1 次。它是概念方向 Pilot，只帮助选择和描述方向，不形成普遍因果结论。

### 停止规则

- preflight 若不是 revision 0 的干净文档，停止并重启；
- 两版必须在任一设计 preview 前完成同一笔 dry-run + committed transaction；
- measurement 若发现意外裁切，每版最多 1 次只改变位置/字号的技术修正；
- 第一张准确的大图和缩略图各展示一次后停止设计写入，等待成对评价；
- 人类评价后关闭本 Session；任何 hybrid、颜色变化、字体变化或概念精修另建 Session；
- capability、文案、frame 或字体条件改变时立即停止。

### 盲评方式

不盲。项目所有者提出“两种都试”，已经知道两种 art direction；展示时使用 N/U
标签并明确这是 revealed comparison。为了减少顺序性返工，两版在预览前同时写入。

### 已知混杂因素

- 两个条件是成套 art direction，同时改变多个关系，不能把偏好归因于某一个参数；
- 只有项目所有者一名评价者，且已看过 M；
- 两版使用同一 Agent，同一事务生成，设计能力与条件顺序无法完全分离；
- default font 限制了字体家族层面的表达；
- 当前 Codex 未原生加载 `gfx_*`，仍通过本地 SDK bridge 调用 Companion；
- “冷静”和“地下”具有文化与个人经验差异，本轮的价值是让偏好变得更具体。

> 完成本节后再进行第一笔 MCP 设计写入。开始时间：
> **2026-07-31 16:28:58 PDT**

## 2. Brief

### 目标

让公寓公共区域的路人在远处先感到这是一件有态度、有记忆点的 typographic object，
靠近后立即理解“狗尿不是公寓配套设施，也不要再发生”。比较两种不同的“酷”，而
不是继续优化同一种安全模板。

### 输出与场景

1080 × 1350 竖版，约 A4 比例；电梯或楼道张贴；大图检查字形、光学中心与边缘，
缩略图检查冲击、重心与三层阅读路径。

### 必须内容

`DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`

文字与标点不得改变；N 可把 `AMENITY` 和它的句号拆为两个节点，但语义和呈现必须
保持完整。

### 信息层级

1. 第一眼：`DOG PEE`；
2. 第二眼：`AMENITY.` 的荒诞冲突；
3. 第三眼：`IS NOT AN`、`NOT HERE.`、`NOT AGAIN.` 完成 notice。

### 审美意图

- “创意”：核心形式规则必须来自这句话的语义，而不是附加效果；
- “酷”：有信心、有取舍，不解释过度，只做少数明确动作；
- “独到”：缩略图中存在可记忆的形式，并且把文案替换成普通标题后不再同样成立；
- N 通过秩序与单次破格建立张力；U 通过受控的碰撞、贴边和斜向压力建立张力。

### 视觉关系

- N：秩序 90% / 破格 10%；近对称；留白主动；句号承担唯一异常。
- U：秩序 45% / 压力 55%；明显不对称；字块互相逼近；边缘紧张但内容完整。

### 视觉参考及参考原因

不引入外部作品。N 只继承 M 已被确认的空间协调经验；U 使用对地下海报语言的抽象
关系描述，不复刻具体作品。

### 反例与避免项

- 不做物业信件、标题/正文/落款结构或解释段落；
- 不使用狗、尿滴、警告三角、禁止符号等图标；
- N 不靠多个装饰性异常制造“创意”；
- U 不靠随机噪声、不可读叠字或普遍性 distressed 效果假装“地下”；
- 不因 intentional tension 接受缺字、错误文案或意外裁切；
- 不新增颜色，不更换字体条件。

### 必须保留

固定文案、frame、纯文字、三种颜色角色、notice 功能、荒诞幽默和非攻击性。

### Agent 自由度

Agent 可在各条件已声明的关系内调整字号、字重、位置、旋转、anchor、留白与
`AMENITY.` 的节点拆分；不得跨条件混合，不得在预览后重新定义“酷”。

### 验收信号

- 两版 Q0–Q1 通过，所有必读文字组在首次展示前由 exact ticket 证明没有意外裁切；
- 缩略图仍能按 `DOG PEE` → `AMENITY.` → stop phrases 阅读；
- N 只有一个明显异常，并且句号不再让 `AMENITY` 字母主体看似偏左；
- U 第一眼明显比 M 更猛烈，但仍可在正常距离理解完整 notice；
- 人类能够具体说出更偏好哪种“酷”以及原因。

## 3. Run 记录

### AE-20260731-T5-two-kinds-of-cool-N-R1

#### 环境与基线

- 开始/结束时间：2026-07-31 16:28:58 PDT / 2026-07-31 17:03:28 PDT
- Agent：Codex desktop；当前任务不可见精确模型版本
- MCP/capability：Package `0.0.1`；protocol `1.0`；Git `ae13bfd`；9 个
  read/preview/edit tools；`rendered-node-measurement-v1`
- Scopes：read、preview、edit；Trusted Local
- Baseline revision：`0`
- Baseline layers：`layer_1`；2304 × 3456；仅默认 `Output`
- 与预注册的偏离：第一次 `gfx_get_document` 使用了旧印象中的 `include`、
  `maxNodes`、`maxEdges` 参数，被 SDK schema 以 `INVALID_ARGUMENT` 拒绝；随后以空参数
  重试成功。未发生设计写入，不影响干净起点。

#### Agent 执行前解释与策略

- 两列骨架保留 M 的可信秩序；
- `AMENITY` 不 warp，按照字母主体居中；句号独立、橙红、偏离基线，成为唯一事件；
- 其他文字全部服从共同列中心与横向规则；
- 大图检查句号和字母主体的光学关系，缩略图检查唯一破格是否足够有记忆点。

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_get_capabilities` | — | protocol、nodes、measurement、font permission | success | 0 | 6 ms |
| 2 | `gfx_get_document` | — | 带旧投影参数的 preflight | `INVALID_ARGUMENT`；未写入 | 0 | 1 ms |
| 3 | `gfx_get_document` | — | 空参数重试 | revision 0 干净文档 | 0 | 2 ms |
| 4 | `gfx_apply_transaction` | `...both-design-dryrun-V1` | 同时建立 N/U；负 rotation amount | `INVALID_ARGUMENT`；未写入 | 0 | 15 ms |
| 5 | `gfx_apply_transaction` | `...both-design-dryrun-V2` | 用 `invert` 表达相同负旋转 | dry-run valid | 0 → proposed 1 | 15 ms |
| 6 | `gfx_apply_transaction` | `...both-design-commit-V1` | 同一事务提交 N/U；只显示 N | committed；`transaction_1` | 0 → 1 | 18 ms |
| 7 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 1 | 5 ms |
| 8 | `gfx_await_render` | — | N exact ticket | complete；attempt 1 | 1 | 2 ms |
| 9 | `gfx_measure_rendered_nodes` | — | N 的 7 个最终 Place 输出 | 7/7 measured inside | 1/attempt 1 | 4 ms |
| 10 | `gfx_capture_preview` | — | N；1024 bound；PNG + metrics | 819 × 1024 | 1 | 62 ms |
| 11 | `gfx_capture_preview` | — | N；256 bound；PNG + metrics | 204 × 256 | 1 | 9 ms |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| N large | 1/attempt 1 | 819 × 1024 | `96fb0f0c1fafddf5009853e58824d4b7f2716363b1e7a1c9d1bd6b0b2c884e41` | `test-results/.../previews/t5-n-preview-large-r1-1.png` |
| N thumbnail | 1/attempt 1 | 204 × 256 | `af7e4cdebc0c9fb09a55c8f078f895cbd27f6e20d151d611f3f03b10d78ceaf0` | perceptual hash `ba3d0d4a3e35c5c2` |

Preview 前的 exact-ticket 几何证据：

| 文字组 | Node | Unclipped bounds (x, y, w, h) | Clipping |
| --- | --- | --- | --- |
| `DOG` | `place_1` | 118.39, 91.63, 323.22, 156.75 | inside；0 overflow |
| `PEE` | `place_2` | 638.20, 93.52, 323.59, 152.97 | inside；0 overflow |
| `IS NOT AN` | `place_3` | 387.75, 366.94, 304.52, 46.13 | inside；0 overflow |
| `AMENITY` | `place_4` | 171.27, 539.16, 737.47, 141.69 | inside；0 overflow |
| 独立 `.` | `place_5` | 827.19, 752.59, 95.63, 94.81 | inside；0 overflow |
| `NOT HERE.` | `place_6` | 94.52, 1085.83, 370.97, 58.34 | inside；0 overflow |
| `NOT AGAIN.` | `place_7` | 613.05, 1088.67, 373.91, 52.66 | inside；0 overflow |

#### Agent 两遍评价

需求与硬约束：

- Q0 通过：revision 1 / attempt 1 的 validation、measurement 与两张 preview 对应
  同一 exact ticket；0 errors/warnings。
- Q1 通过：固定文案与标点完整；`AMENITY` 和独立句号共同构成 `AMENITY.`；frame
  1080 × 1350；无资产；7/7 最终文字组均 inside。
- 两版的设计节点和参数已在任何 preview 前由同一 `transaction_1` 固定。

审美质量：

- 顶部 `DOG` / `PEE` painted width 只差 0.37 px；底部两句只差 2.94 px，严格秩序
  具有可测量依据。
- `AMENITY` 字母主体的 bounds 以 x=540 为中心，不再因为尾部句号被几何性左推；
  独立句号成为右下方唯一脱离基线的异常。
- 句号的尺度和 190 px 的下坠使它首先读作 graphic punctuation，其次才像普通句号；
  这是概念强度，也是可能被人类认为过于显眼或过于安全的风险。
- 整体阅读非常清楚，主动留白完整；与 M 相比，独特性来自一个内容相关的动作，
  但其余排版仍有接近“完成度高的安全海报”的可能。

#### 人类反馈

> 我觉得这两张is good for me rn. 这次很好，我觉得是达到了一定的alignment &
> aesthestics的。
>
> So what now?

项目所有者接受 N，未提出继续修改；也没有报告 N 相对 U 的偏好。

#### 修订及保留关系

- 相对 M 保留：两列可信秩序、清楚三层阅读、酸黄/近黑/橙红角色。
- 改变：移除 `AMENITY` 的 warp；把句号拆成独立的 95.63 × 94.81 px painted mark；
  其余元素保持严格中心与配平。
- revision 1 是 N 的 exact preview；revision 2 只切换 visibility，没有改变 N 节点。

#### 最终结果

- Final revision：设计内容 revision `1` / render attempt `1`
- 停止原因：项目所有者认为 N 与 U 均已达到当前 alignment 与 aesthetics 阈值；
  不为完成实验而强迫产生单一胜者。
- Tool calls：共享流程总计 18；N 展示完成时累计 11。
- Transactions：共享 design `transaction_1`；另有 successful dry-run；visibility
  transaction 记在 U。
- Feedback rounds：1 次成对评价；0 次据此修订
- Failures/conflicts/reverts/retries：1 次只读 document schema retry；1 次 rotation bind
  schema retry；0 conflicts；0 reverts；0 measurement hard-fix。
- 总时长：34 分 30 秒（双候选准确 preview 在 6 分 28 秒时完成，其余为人类评价
  等待时间）

### AE-20260731-T5-two-kinds-of-cool-U-R1

#### 环境与基线

- 开始/结束时间：2026-07-31 16:28:58 PDT / 2026-07-31 17:03:28 PDT
- Agent：Codex desktop；当前任务不可见精确模型版本
- MCP/capability：Package `0.0.1`；protocol `1.0`；Git `ae13bfd`；9 个
  read/preview/edit tools；`rendered-node-measurement-v1`
- Scopes：read、preview、edit；Trusted Local
- Baseline revision：与 N 同一 revision `0` 设计事务
- Baseline layers：`layer_1`；2304 × 3456；仅默认 `Output`
- 与预注册的偏离：同 N；只有一次只读 schema 参数失败。

#### Agent 执行前解释与策略

- `DOG` 与 `PEE` 使用不同的斜向压力和超大尺度形成无法回避的顶部碰撞；
- `IS NOT AN` 像窄小的连接铰链，`AMENITY.` 以橙红色横向顶住画幅中部；
- 两句 stop phrase 使用不对称堆叠和相反方向的轻微旋转，形成重复发生的压迫节拍；
- 所有旋转、贴边和碰撞都服务一条从顶部冲击到底部制止的阅读路径。

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | `gfx_apply_transaction` | `...switch-U-dryrun-V1` | N hidden；U visible | dry-run valid | 1 → proposed 2 | 7 ms |
| 13 | `gfx_apply_transaction` | `...switch-U-commit-V1` | 仅切换 layer visibility | committed；`transaction_2` | 1 → 2 | 19 ms |
| 14 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 2 | 3 ms |
| 15 | `gfx_await_render` | — | U exact ticket | complete；attempt 1 | 2 | <1 ms |
| 16 | `gfx_measure_rendered_nodes` | — | U 的 6 个最终 Place 输出 | 6/6 measured inside | 2/attempt 1 | 1 ms |
| 17 | `gfx_capture_preview` | — | U；1024 bound；PNG + metrics | 819 × 1024 | 2 | 51 ms |
| 18 | `gfx_capture_preview` | — | U；256 bound；PNG + metrics | 204 × 256 | 2 | 6 ms |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| U large | 2/attempt 1 | 819 × 1024 | `0b66e3faa97b9593d823ce872b05ceea65e7fc2325c090a8b82bb25eb0f76f78` | `test-results/.../previews/t5-u-preview-large-r1-1.png` |
| U thumbnail | 2/attempt 1 | 204 × 256 | `9310077d072cd27f3429696d8237d579995292f8bec0d72d74846c90c6955d21` | perceptual hash `b33633b1bcd1c06a` |

Preview 前的 exact-ticket 几何证据：

| 文字组 | Node | Unclipped bounds (x, y, w, h) | Clipping |
| --- | --- | --- | --- |
| `DOG` | `place_1` | 18.78, 25.81, 572.44, 328.38 | inside；0 overflow |
| `PEE` | `place_2` | 467.77, 183.63, 604.47, 332.75 | inside；右侧余量 7.77 px |
| `IS NOT AN` | `place_3` | 86.88, 566.06, 306.25, 47.88 | inside；0 overflow |
| `AMENITY.` | `place_4` | 110.48, 667.41, 859.03, 195.19 | inside；0 overflow |
| `NOT HERE.` | `place_5` | 32.63, 955.16, 574.75, 149.69 | inside；0 overflow |
| `NOT AGAIN.` | `place_6` | 419.59, 1110.44, 570.81, 149.13 | inside；0 overflow |

#### Agent 两遍评价

需求与硬约束：

- Q0 通过：revision 2 / attempt 1 的 validation、measurement 与两张 preview 对应
  同一 exact ticket；0 errors/warnings。
- Q1 通过：固定文案、标点、frame、颜色角色和纯文字条件完整；6/6 最终文字组均
  inside。`PEE` 右侧只有 7.77 px，但这是已声明的 edge tension，不是裁切。
- layer visibility transaction 没有改变任一候选的设计节点或参数。

审美质量：

- 超大 `DOG` 和 `PEE` 以相反斜向相撞，几乎占满顶部；缩略图中第一眼冲击显著
  高于 N 和 M。
- 红色 `AMENITY.` 横跨中部，下面两句以相反角度继续向下压，形成一条从碰撞到制止
  的连续斜向节奏，而不是随机旋转。
- `DOG` 与 `PEE` 的重叠处让 `P` 进入 `G` 的负空间，具有记忆点，也可能短暂降低
  单词边界清晰度；这是 U 的主要审美风险。
- U 更接近地下海报的强度，但 default font 仍非常干净；当前“地下”主要来自尺度、
  边缘和角度，而不是字体质感。
- `AMENITY.` 仍是一个完整字符串，句号的低视觉重量没有被单独修正；动态重心减弱
  了 M 中的静态偏心感，但不能宣称问题已消失。

#### 人类反馈

> 我觉得这两张is good for me rn. 这次很好，我觉得是达到了一定的alignment &
> aesthestics的。
>
> So what now?

项目所有者接受 U，未提出继续修改；也没有报告 U 相对 N 的偏好。

#### 修订及保留关系

- 相对 M 保留：固定文案、三层阅读、颜色角色和 notice 功能。
- 改变：放弃两列静态对称；以 320/340 px 超大顶部、相反旋转、边缘余量和不对称
  底部堆叠建立压力。
- U 的所有设计参数与 N 同在 revision 1 创建；revision 2 只使 U 可见并使 N 隐藏。

#### 最终结果

- Final revision：设计内容 revision `1`；展示 revision `2` / render attempt `1`
- 停止原因：项目所有者认为 N 与 U 均已达到当前 alignment 与 aesthetics 阈值；
  不为完成实验而强迫产生单一胜者。
- Tool calls：从 N 展示完成后新增 7；共享流程总计 18。
- Transactions：共享 design `transaction_1`；visibility `transaction_2`；各自均先
  successful dry-run。
- Feedback rounds：1 次成对评价；0 次据此修订
- Failures/conflicts/reverts/retries：同共享流程；U measurement 后不需要技术修正。
- 总时长：34 分 30 秒（双候选准确 preview 在 6 分 28 秒时完成，其余为人类评价
  等待时间）

## 4. 评价

### Revealed 成对偏好

| 比较 | 选择 | 置信度 | 原因 |
| --- | --- | --- | --- |
| N vs U | 无单一胜者；两版均接受 | 未报告 | 两版在当前阶段都达到一定的 alignment 与 aesthetics |

### 维度评分

| Run | 需求符合度 | 信息层级 | 构图与空间 | 字体与文字 | 色彩 | 一致性 | 独特性 | 完成度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-R1（Agent provisional） | 5 | 5 | 5 | 4 | 5 | 5 | 4 | 5 |
| U-R1（Agent provisional） | 5 | 4 | 4 | 4 | 5 | 4 | 4 | 4 |

每个分数的可观察证据：

- 两版均完整保留文案、frame、颜色和 notice 功能，Q0–Q1 通过。
- N 在顶部与底部有实测配平，`AMENITY` 字母主体光学问题被明确处理；其风险是
  唯一破格仍可能不足以脱离“安全海报”。
- U 的缩略图冲击和斜向节奏更强，但 `DOG` / `PEE` 重叠降低了一点词边界清晰度，
  且地下感仍可能被判断为一种可替换文案的通用风格。
- 两版颜色完全相同，色彩评分不用于解释偏好差异。
- 人类接受两版均达标，但没有逐维打分；以上分数仍只记录 Agent 诊断，不替代主要
  的人类接受结果。

### Agent 与人类评价的分歧

- Agent 预先指出 N 可能仍偏安全、U 可能牺牲一点词界；人类没有把这些风险视为当前
  阶段的阻碍，而是接受两版均达标。
- 人类没有选择 N 或 U，因此 Agent 的维度差异不能被解释为人类排序；本轮主要结果
  是双方案达到接受阈值，不是比较出冠军。

## 5. 偏离、失败与混杂因素

- 第一次 preflight `gfx_get_document` 带入了该工具当前 schema 不接受的查询投影参数，
  返回 recoverable `INVALID_ARGUMENT`；空参数重试成功，revision 仍为 0。
- 第一次双候选 dry-run 把负旋转直接编码为负的 bind amount；schema 要求 amount 为
  0–1。用 `invert: true` 与同一正幅度表达原定负方向后重试成功；角度、位置与概念
  没有改变，revision 仍为 0。

## 6. 结论

### 本 Session 支持的结论

- 将模糊的“创意、酷、独到”拆成两套相反但具体的视觉关系，比继续对 M 做无方向
  微调更有效：N 与 U 都被项目所有者认为达到当前 alignment 与 aesthetics 阈值。
- 达到审美 alignment 不要求所有候选收敛到同一种安全风格。严格秩序中的单次破格
  和受控的地下式压力可以同时成立。
- 在看到任一 preview 前同时固定两版，成功保留了方向差异；人类评价没有要求把 U
  修得像 N，或把 N 强行变得像 U。
- MCP 在本案例中可靠承担了几何硬门槛：13/13 最终文字/标点组在首次展示前均被
  exact-ticket measurement 证明没有意外裁切。

### 本 Session 不能支持的结论

- 不能宣称 N 或 U 更好，因为人类没有给出成对排序。
- 不能把双方案达标归因于某一个参数；两个条件都是同时改变多项关系的 art-direction
  bundle，且只有一名评价者、每条件一次运行。
- 不能证明海报在真实电梯、楼道、纸张、观看距离或打印色彩下同样有效。
- 不能证明当前字体是最佳选择；Agent 仍不能枚举或写入本地字体。

### 对 Brief 写法的启示

- “酷”需要拆成可对比的关系，例如“90% 秩序 + 10% 破格”与“尺度压迫 + 斜向碰撞
  + 贴边”，而不是要求 Agent 猜一个唯一答案。
- 用户说“两种都试试”不是缺少决策，而是一种有效的探索指令；它让审美目标通过
  实物比较变得可感知，也允许结果是“两者都达到阈值”。
- “good for me rn”说明验收可以是阶段性的接受阈值，不必为了追求抽象满分继续磨掉
  已经成立的个性。

### 对 Agent 工作流的启示

- 当用户从 refinement 转向概念探索时，应先冻结已知约束，再并行展开差异足够大的
  候选；同事务预先固定两个方向可减少看到第一版后对第二版的无意识收敛。
- 人类明确认为多个方向都达标时应停止设计写入。下一步应改变验证环境或交付阶段，
  而不是继续添加装饰和 revision。
- 本轮显示“先对话定义审美轴 → 同时做两个候选 → 人类判断接受阈值”是一条有效的
  Agent × MCP 协作模式。

### 对 MCP/API 设计的启示

- rendered bounds 很适合把 intentional edge tension 与意外裁切区分开；U 的最小
  右边距只有 7.77 px，但仍能给出明确 inside 证据。
- rotation bind 的正负方向需要 `amount + invert` 组合，第一次使用并不直观；schema
  或文档可提供角度/方向示例，或未来暴露直接的 signed rotation helper。
- geometry 可以把 alignment 的一部分变为证据，但最终的“这两张对我都好”仍必须
  由人类给出。

### 下一步实验

- 首选：停止屏幕内审美优化，进入真实场景验证。把 N 与 U 以 A4 实际尺寸放入电梯
  或楼道环境，检查 1–3 米距离的第一眼阅读、纸张/照明下的色彩、以及哪一种语气更
  适合实际张贴位置。
- 当前 MCP capability 没有 export tool；若要由 Agent 完成交付，应把“可追溯的
  print-ready PDF/PNG export”作为下一项产品能力或单独生产流程验证，而不是把 preview
  文件误当成最终印刷资产。

后续项目级澄清（2026-07-31）：上述建议仍适用于完成这张海报，但项目所有者重新明确
了整个实验系列的优先目标——验证 Agent × MCP 审美协作是否能跨任务稳定迁移，并在
证据充分后沉淀为 Skill。因此项目级下一项研究优先使用新任务验证
[`PLAYBOOK.zh-CN.md`](../PLAYBOOK.zh-CN.md)；这不改变本 Session 的问题、条件、结果或
停止原因。

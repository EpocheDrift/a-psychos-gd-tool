# AE-20260728-S1-brief-pilot — Brief × 协作流程 Pilot

状态：**Stopped — MCP capability 在 C 第 1 轮反馈后升级；结果保留为探索性 Pilot**

Spec 版本：**0.1.0**

日期：**2026-07-28**

负责人：**项目所有者 × Codex**

## 1. 预注册

### 研究问题

- RQ1：在语义信息保持等价时，把用户的自然语言需求整理成结构化 Brief，是否改变
  需求符合度和审美质量？
- RQ2：在结构化 Brief 基础上增加执行前策略确认和最多两轮视觉反馈，是否带来
  可感知的质量提升？
- RQ3：增加的质量提升是否值得额外的交互、调用和 revision 成本？

### 假设

- H1：结构化 Brief 会提高需求符合度，但不必然提高独特性。
- H2：执行前明确设计策略会减少方向性返工。
- H3：有限的准确 revision 视觉反馈会提高完成度，但有使结果趋于保守的风险。

### 任务族

**T1 — 纯文字海报**

### 固定任务与完整文案

项目所有者已提供原始背景与需求。当前已固定：

- 使用约一张 A4 纸大小的竖版告示；
- 纯文字、纯排版，不使用外部图片；
- 告示文案使用英文；
- 告示针对公寓电梯或楼道里持续出现的狗尿问题；
- 核心表达是“不要天天撒尿了”；
- 语气需要有冲击力（原文使用 `impress`）且稍微搞笑；
- `impress` 已由项目所有者确认为：远距离醒目、态度明确、带一点荒诞幽默，
  不是温吞的物业通知，但也不辱骂、不威胁狗主人；
- 成品应弱化信件、解释和传统告知感，更像公共空间中的一件排版艺术；
- 不需要明确的沟通主体或收件人，但仍须发挥 notice 的功能；
- 文案应短，让夸张和荒诞幽默主要通过纯排版表达。

正式开始前仍须固定：

- MCP capability、字体条件、初始文档和实际 scopes。

### 条件

#### A — 自然语言 + 直接执行

- 使用项目所有者提供的原始自然语言需求；
- 不向项目所有者展示 Agent 的执行前策略；
- 第一张对应准确 revision 的 preview 产生后停止；
- 不做审美修订。

#### B — 等价结构化 Brief + 直接执行

- 只重新组织 A 中已有的信息，不新增审美要求；
- 未提供的信息明确标为“未指定”，不由 Agent 补全为用户要求；
- 项目所有者在 Run 开始前确认 A 与 B 语义等价；
- 不向项目所有者展示 Agent 的执行前策略；
- 第一张对应准确 revision 的 preview 产生后停止；
- 不做审美修订。

#### C — 等价结构化 Brief + 策略确认 + 视觉反馈

- 使用与 B 完全相同的 Brief；
- Agent 在写入前展示设计策略，项目所有者确认后执行；
- 最多两轮人类反馈；
- 每轮只处理项目所有者声明的最高优先级问题；
- 项目所有者明确表示目标达到时可以提前停止。

### 控制变量

| 变量 | 固定值 |
| --- | --- |
| Agent 产品/模型/版本 | Codex desktop；当前任务可见的精确模型版本未提供 |
| MCP Companion/capability 版本 | Companion `0.0.1`；protocol `1.0`；document schema `3/4`；31 个节点 |
| 代码基线 | Git `76e8064`，另有本实验文档未提交修改 |
| 浏览器/操作系统 | Google Chrome `151.0.7922.47`；macOS `26.5.2` (`25F84`) |
| Frame | 1080 × 1350 |
| 字体条件 | Text `font=default`；font 参数不可由 Agent 写入，本地字体不可枚举；三个条件保持同一会话 |
| 资产 | 不使用外部资产 |
| Scopes | Companion 仅暴露 8 个 read/preview/edit 工具；项目所有者已在浏览器批准 `read`、`preview`、`edit`；未暴露 asset/model 工具 |
| 初始文档 | revision `0`；2304 × 3456；`layer_1` 仅有默认 `Output`；每个 Run 创建独立实验图层 |
| 候选数 | 每个条件 1 个 |
| 反馈轮数 | A/B 为 0；C 最多 2 |
| 时间预算 | Pilot 不设硬时间上限，但记录实际耗时 |
| 条件运行顺序 | A → B → C |
| 前序结果可见性 | 同一 Codex 任务顺序执行，Agent 可见前序结果 |

### 主要结果

1. 隐去条件名称后，项目所有者对三个最终版本进行成对偏好选择并说明原因；
2. 需求符合度、信息层级、构图与空间、字体与文字、独特性的 1–5 分评价及证据；
3. C 相对 A/B 的可感知提升是否值得额外交互成本。

### 次要结果

- 色彩、一致性和完成度评分；
- MCP tool calls、transactions、revision 增量、反馈轮数和总时长；
- Agent 执行前预期、执行后自评与人类评价的分歧；
- A/B 是否因格式不同产生不同的设计假设；
- C 每轮反馈中被保留和被改变的视觉关系。

### 重复次数

Pilot 每个条件 **1 次**。结果只用于调试实验协议和形成后续假设，不形成普遍性
结论。协议稳定后另建正式 Session，每个条件至少 3 次。

### 停止规则

- A、B 在第一张准确 preview 后停止；
- C 最多两轮反馈，或项目所有者明确表示目标已达到时提前停止；
- 技术失败按 MCP 恢复协议处理，不计作审美修订轮；
- 若 A 与 B 的语义信息不等价，整个 Pilot 作废并以新 Session ID 重新开始；
- 若任何条件使用不同的文案、frame、字体条件或非实验资产，Pilot 作废；
- 若 MCP 不能提供准确 revision 的 preview，则暂停，不以 UI 目测结果替代。

### 盲评方式

完成三个条件后，把最终版本复制为随机化的中性标签，隐藏条件名称、执行顺序、
Agent 策略、调用数和 revision，再交由项目所有者进行三组成对比较。随机化映射在
展示前记录，评价完成前不揭示。

本 Pilot 只有一名评价者，属于已知限制。

### 已知混杂因素

- 三个条件在同一 Codex 任务中按 A → B → C 执行，Agent 可从先前 Run 学习；
- C 同时增加策略确认和反馈，不能区分二者各自的独立贡献；
- A/B/C 的交互预算不同，比较的是整体协作流程，不是同成本算法表现；
- 每个条件只有一次运行，Agent 输出方差未知；
- 只有项目所有者一名评价者；
- 当前 Agent 精确模型版本不可见；
- 项目当前字体选择和文字排版能力可能限制审美表达；
- 工具能力限制与 Agent 审美判断可能相互混杂。
- 当前 Codex 任务未原生加载 `gfx_*` 工具，使用任务内持久 Node REPL 运行官方
  MCP SDK Client，通过生产 stdio Companion 调用相同工具；这增加了一层本地调用
  桥接，但没有绕过 MCP、配对、scope、controller、revision 或 render 路径。

> 完成本节中的原始需求、等价 Brief、字体条件和 MCP Preflight 后，才能进行第一笔
> MCP 设计写入。开始时间：**2026-07-28 21:30:53 PDT**

## 2. Brief

### 2.1 条件 A 原始自然语言（公开版摘要）

项目所有者于 2026-07-28 提供了自然语言需求。为避免在公开仓库发布家庭与居住场景
的逐字对话，本记录只保留与实验等价的结构化事实；完整原文仅保存在私有封存证据中：

- 公寓公共区域连续两周以上反复出现未被清理的宠物卫生问题，频率约为每两天一次；
- 希望制作约一张 A4 大小的英文告示，形式为纯文字、纯排版；
- 目标语气是远距离醒目、稍微夸张并带荒诞幽默；
- 不希望它像信件、物业通知或由某个主体发出的沟通，更接近公共空间中的排版艺术，
  同时仍保留 notice 的功能；
- 项目所有者不预设具体审美或排版解法，并在看到第一版长文案后要求进一步压缩文案。

在正式 Run A 开始前，会把最终确认的完整告示文案作为相同的硬约束附加给
A/B/C。除此之外，不润色或补充条件 A 的需求描述。

### 2.2 条件 B/C 等价结构化 Brief

以下内容只能从 2.1 的公开摘要与私有封存原文重组，不得添加新的用户要求。

#### 目标

通过张贴在公寓公共区域的告示，表达对持续狗尿问题的不满，并传达“不要天天
撒尿了”。

#### 输出与场景

- Frame：1080 × 1350
- 物理参照：约一张 A4 纸大小；
- 场景：公寓电梯或楼道；
- 形式：纯文字、纯排版；
- 语言：英文。

#### 必须内容

- 核心表达：“不要天天撒尿了”；
- 固定英文文案：`DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`
- 单词顺序和标点固定；大小写、断行、字号和视觉层级属于 Agent 的排版决策。

#### 信息层级

未指定具体层级。文案需要保持简短，排版而不是说明性正文承担主要表达。

#### 审美意图

- 远距离醒目、态度明确、带一点荒诞幽默；
- 不是温吞的物业通知，但也不辱骂、不威胁狗主人；
- 稍微搞笑；
- 更像公共空间中的排版艺术，同时仍是一种 notice。

#### 视觉关系

- 稍微夸张；
- 荒诞幽默；
- 弱化信件和传统告知感；
- 不需要明确的沟通主体或收件人；
- 具体排版方法未指定，项目所有者明确表示目前不清楚可以如何处理。

#### 视觉参考及参考原因

未提供。

#### 反例与避免项

- 不使用图片；
- 避免长篇解释性正文；
- 避免像信件或常规物业通知；
- 避免依赖明确的“我/我们对你”沟通主体；
- 其他未指定。

#### 必须保留

- 固定英文文案：`DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`
- 单词顺序和标点；
- 英文输出；
- 纯文字、纯排版；
- 约 A4 尺寸；
- 有冲击力且稍微搞笑的表达；
- 作为排版艺术成立，同时保持 notice 功能；
- 核心意思“不要天天撒尿了”。

#### Agent 自由度

项目所有者没有预设审美或排版方案。未由用户限制的设计决策允许 Agent 自主处理，
但 Agent 的选择不视为用户偏好。

#### 验收信号

告示能够以短文案和纯排版产生夸张、荒诞幽默的冲击，让人理解“不要天天撒尿
了”；观看感受更接近排版艺术，而不是一封信或说明性物业通知。更具体的可观察
标准未指定，使用 Spec 的通用评价维度。

### 2.3 A 与 B/C 信息等价确认

状态：**已确认**

项目所有者确认语句：

> 好，文字没问题，你对我感觉/需求的确认也没问题

确认日期：**2026-07-28**

确认范围：

- 固定英文文案；
- `impress` 的任务内含义；
- 短文案、纯排版、稍微夸张和荒诞幽默；
- 弱化信件、说明和传统物业告知感；
- 无需明确沟通主体，同时保持 notice 功能；
- 条件 B/C 对原始需求的结构化表达没有新增用户要求。

### 2.4 实验前文案决策记录

- 第一版英文草案包含标题、场景说明、持续时间、清理要求和幽默结尾；
- 项目所有者否决该版本，原因为文案过长，整体仍偏向信件/告知；
- 被否决的版本不得用于任何 Run；
- 下一版必须减少说明性语言，不依赖明确发送者/接收者，并为纯排版保留表达空间。
- 第二版文字 `DOG PEE IS NOT AN AMENITY. NOT HERE. NOT AGAIN.` 已由项目
  所有者确认并冻结；
- 进入 MCP Preflight 后不得改变文字、需求或评价标准；若需改变，按 Spec 创建
  新 Session。

## 3. Run 记录

以下内容在 Preflight 和各 Run 执行时填写。

### MCP Preflight

- 时间：2026-07-28 21:30:53 PDT
- Client：任务内持久 Node REPL 中的官方 `@modelcontextprotocol/sdk` Client
- Transport：bounded stdio → Companion → authenticated same-origin WebSocket
- Companion：`0.0.1`
- Protocol：`1.0`
- Document schemas：`3`, `4`
- Tool profile：8 个工具；read、preview、edit；无 asset/model 工具
- Human pairing：项目所有者已批准 read、preview、edit
- Capability：31 个 node types；transactions、dry-run、preview 和 MCP 可用
- Frame limits：16–4096 px/side；最大 4096² pixels
- Preview：PNG/WebP；最大边长 1024；`current-exact-ticket-v1`
- Typography limitation：Text 使用人类选择的 `default` font key；Agent 不可写入
  font 参数，本地字体枚举关闭
- Baseline revision：`0`
- Baseline frame：2304 × 3456
- Baseline layers：`layer_1`，visible，normal，1 个默认 `Output`，0 edges
- 隔离决定：保留 `layer_1`；A/B/C 各自创建独立命名图层；评价一个条件时隐藏其他
  条件图层；不修改或删除 `layer_1` 的图结构
- Preflight `gfx_*` 调用：3（capabilities 1；document 2）
- 结果：通过；允许进入条件 A

### AE-20260728-S1-brief-pilot-A-R1

#### 环境与基线

- 开始/结束时间：2026-07-28 21:32:26 PDT / 2026-07-28 21:33:43 PDT
- Agent：Codex desktop；当前任务可见的精确模型版本未提供
- MCP/capability：Companion `0.0.1`；protocol `1.0`；31 node types
- Scopes：read、preview、edit
- Baseline revision：`0`
- Baseline layers：`layer_1`，仅默认 Output
- 与预注册的偏离：

#### Agent 执行前解释与策略

本条件不向项目所有者展示；执行前仍在记录中保留。

<details>
<summary>封存至盲评完成后再阅读</summary>

- 需求复述：把短英文 notice 作为公共空间中的排版物，而不是信件；通过夸张节奏和
  公寓语义中的 `AMENITY` 反差制造荒诞幽默。
- 构图骨架：把 10 个单词按阅读顺序映射到 2 × 5 的非均匀网格，让短词和长词在
  同一系统里形成不稳定但可读的节奏。
- 字体角色：使用会话固定字体，超粗 synthetic weight；不伪造字体选择能力。
- 色彩角色：近黑文字配高亮酸性黄绿色底，以公共警示色制造远距离冲击，但避开
  常规红色物业警告。
- 主要机制：Text → Split(words) → Place；Grid 控制空间；Output 提供实色背景。
- 阅读路径：逐行左到右，语义停顿为 `DOG PEE / IS NOT / AN AMENITY. /
  NOT HERE. / NOT AGAIN.`
- 验证重点：1024 preview 检查单词裁切和字形；256 preview 检查五拍节奏与整体
  冲击。
- 本 Run 不解决：字体选择、更多候选方向、基于预览的审美修订。

</details>

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_apply_transaction` | `AE-20260728-S1-C-R1-dryrun-V1` | 隐藏 B；创建五段排版与 composite 链 | `REVISION_CONFLICT`；未写入 | expected 2；current 10 | 12 ms |
| 2 | `gfx_get_document` | — | 冲突恢复；读取 current 全文档 | 图层/节点内容未变；current revision 10 | 10 | 6 ms |
| 3 | `gfx_apply_transaction` | `AE-20260728-S1-C-R1-dryrun-V2` | 相同计划，以 revision 10 重试 | dry-run valid；未提交 | 10 → proposed 11 | 18 ms |
| 4 | `gfx_apply_transaction` | `AE-20260728-S1-C-R1-build-V1` | 五段独立 Place；AMENITY warp；4-stage Composite | committed；durable；`transaction_3` | 10 → 11 | 30 ms |
| 5 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 11 | 6 ms |
| 6 | `gfx_await_render` | — | revision 11；attempt 1 | complete；displayed revision 11 | 11 | 2 ms |
| 7 | `gfx_capture_preview` | — | 1024 bound；PNG；metrics | 819×1024；62,268 bytes | 11 | 62 ms |
| 8 | `gfx_capture_preview` | — | 256 bound；PNG；metrics | 204×256；7,322 bytes | 11 | 9 ms |
| 9 | `gfx_apply_transaction` | `AE-20260728-S1-C-R1-hardfix-dryrun-V1` | 只校正 5 个 Place 横向 offset | dry-run valid；未提交 | 11 → proposed 12 | 15 ms |
| 10 | `gfx_apply_transaction` | `AE-20260728-S1-C-R1-hardfix-V1` | 与 hard-fix dry-run 相同 | committed；durable；`transaction_4` | 11 → 12 | 27 ms |
| 11 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 12 | 3 ms |
| 12 | `gfx_await_render` | — | revision 12；attempt 1 | complete；displayed revision 12 | 12 | 1 ms |
| 13 | `gfx_capture_preview` | — | 1024 bound；PNG；metrics | 819×1024；70,811 bytes | 12 | 64 ms |
| 14 | `gfx_capture_preview` | — | 256 bound；PNG；metrics | 204×256；8,401 bytes | 12 | 7 ms |
| 15 | `gfx_get_document` | — | exact revision；C layer graph | 18 nodes；21 edges | 12 | 4 ms |
| 1 | `gfx_apply_transaction` | `AE-20260728-S1-A-R1-dryrun-V1` | 1080×1350；隔离默认层；创建 Text/Split/Grid/Place | dry-run valid；未提交 | 0 → proposed 1 | 25 ms |
| 2 | `gfx_apply_transaction` | `AE-20260728-S1-A-R1-build-V1` | 与 dry-run 相同的原子事务 | committed；durable；`transaction_1` | 0 → 1 | 11 ms |
| 3 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 1 | 8 ms |
| 4 | `gfx_await_render` | — | revision 1；attempt 1 | complete；displayed revision 1 | 1 | 5 ms |
| 5 | `gfx_capture_preview` | — | 1024 bound；PNG；metrics | 819×1024；63,595 bytes | 1 | 80 ms |
| 6 | `gfx_capture_preview` | — | 256 bound；PNG；metrics | 204×256；7,425 bytes | 1 | 9 ms |
| 7 | `gfx_get_document` | — | exact revision；A layer graph | 5 nodes；4 edges；文案参数存在 | 1 | 5 ms |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| C first build large | 11/attempt 1 | 819×1024 | `67d28e72bf0c489d039a0d3b1ce30bf5a01f3457bc37d76cf000e120f6f2d921` | MCP image content；未通过 Q1 |
| C first build thumbnail | 11/attempt 1 | 204×256 | `a6bb5b363843927eb370f04750a18e84cdccc57d3fe37849cb09284ea94f681e` | perceptual hash `e567b5354648989b` |
| C hard-fix large | 12/attempt 1 | 819×1024 | `98e5023b73664b376c144f760e756f468784e6f81a042d9051192d268096113a` | MCP image content；当前反馈基线 |
| C hard-fix thumbnail | 12/attempt 1 | 204×256 | `258835c6e503e7f621a31182faf77fb17c6ee747142335ea398719251587222d` | perceptual hash `bb7a491f5c6183c4` |
| A large final | 1/attempt 1 | 819×1024 | `948b13f70cccc642950b4167780146bcdb7059f00e4d26f69ee71f12017a7a5b` | MCP image content；内存保留用于盲评 |
| A thumbnail final | 1/attempt 1 | 204×256 | `05f062450324236f5943ff2fd505e8ae71edcf1ea045bf6b791d12148d74e0d0` | MCP image content；perceptual hash `f83a3b635858a798` |

#### Agent 两遍评价

需求与硬约束：

- Q0 通过：事务、validation、render 和 preview 均对应 revision 1/attempt 1。
- Frame、英文固定文案参数、纯文字/排版图结构和无外部资产要求均满足。
- Q1 未通过：固定文案虽然完整存在于 Text 参数中，但网格右列的多个单词在画面
  右边界被截断，视觉结果无法完整阅读。
- 按 A 的停止规则，不把这项视觉裁切作为技术异常进行第二次审美事务修正。

审美质量：

- 酸性黄绿色与近黑超粗文字具有远距离冲击，弱化了信件/物业通知感。
- 单词网格把短句变成了重复的视觉拍点，`AMENITY` 的语义反差仍有荒诞潜力。
- 右列裁切明显破坏阅读路径和完成度，且更像未控制的溢出，而不是有意的出血。
- 左右列尺度和边界关系缺少精确控制；大片留白与文字密度的关系尚未形成稳定张力。
- 结果有排版物感，但未达到可交付 notice 的内容硬门槛。

#### 人类反馈

按条件规则不修订 A。项目所有者在 A/B 均完成后提供 revealed feedback：

> 首先这两个的文字都超出了画框。
> 我觉得A还不错，B则是有点怪. 我觉得A还有进步的空间；但是由于我只有对审美的判断，而不知道如何去做，所以我也不知道该怎么给你说。

该反馈不用于回改 A。

#### 最终结果

- Final revision：
- Final revision：`1`
- 停止原因：达到 A 的预注册停止规则——第一张准确 revision preview；未因质量问题修订
- Tool calls：7（另有 Preflight 3 次调用，不计入 Run）
- Transactions：1 committed + 1 dry-run
- Feedback rounds：0
- Failures/conflicts/reverts/retries：0；记录 1 项未修正的视觉硬约束失败（右侧裁切）
- 总时长：77 秒

### AE-20260728-S1-brief-pilot-B-R1

#### 环境与基线

- 开始/结束时间：2026-07-28 21:34:21 PDT / 2026-07-28 21:35:26 PDT
- Agent：Codex desktop；当前任务可见的精确模型版本未提供
- MCP/capability：Companion `0.0.1`；protocol `1.0`；31 node types
- Scopes：read、preview、edit
- Baseline revision：`1`
- Baseline layers：`layer_1` hidden；`layer_2` 为已封存的 A，开始事务时切换为 hidden
- 与预注册的偏离：

#### Agent 执行前解释与策略

本条件不向项目所有者展示；执行前仍在记录中保留。

<details>
<summary>封存至盲评完成后再阅读</summary>

- 需求复述：结构化 Brief 强调“排版艺术仍是一种 notice”，因此以醒目的中心词组
  承担即时识别，以环形剩余句子制造公共印章/设施标识的荒诞挪用。
- 构图骨架：中心横向 `DOG PEE`；其余固定文案沿大圆分布，形成自包含的图形对象。
- 字体角色：同一固定字体；中心使用超大超粗字重，环形信息使用较小但偏粗字重。
- 色彩角色：暖白底、警示橙红中心、近黑环形字；颜色承担中心/外围层级而不是装饰。
- 主要机制：两条 Text → Split → Place 链；Grid 定位中心词组；Function(circle)
  组织环形字符；Composite 合成后进入 Output。
- 阅读路径：先读 `DOG PEE`，再沿圆周发现
  `IS NOT AN AMENITY. NOT HERE. NOT AGAIN.`
- 验证重点：大图检查环形字符与边界；缩略图检查中心识别和印章般整体形状。
- 本 Run 不解决：字体选择、第二候选、预览后的几何校正。

</details>

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_apply_transaction` | `AE-20260728-S1-B-R1-dryrun-V1` | 隐藏 A；中心词组 + 环形字符 + Composite | dry-run valid；未提交 | 1 → proposed 2 | 13 ms |
| 2 | `gfx_apply_transaction` | `AE-20260728-S1-B-R1-build-V1` | 与 dry-run 相同的原子事务 | committed；durable；`transaction_2` | 1 → 2 | 10 ms |
| 3 | `gfx_validate_document` | — | current；renderable | valid；0 errors/warnings | 2 | 5 ms |
| 4 | `gfx_await_render` | — | revision 2；attempt 1 | complete；displayed revision 2 | 2 | 2 ms |
| 5 | `gfx_capture_preview` | — | 1024 bound；PNG；metrics | 819×1024；66,220 bytes | 2 | 66 ms |
| 6 | `gfx_capture_preview` | — | 256 bound；PNG；metrics | 204×256；7,374 bytes | 2 | 7 ms |
| 7 | `gfx_get_document` | — | exact revision；B layer graph | 10 nodes；9 edges | 2 | 5 ms |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| B large final | 2/attempt 1 | 819×1024 | `bc17eea03e42b2c1faf944f74df7e53a816332497cfdd8cd0a361206f688f0bf` | MCP image content；内存保留用于盲评 |
| B thumbnail final | 2/attempt 1 | 204×256 | `5830aeab3abe105193536e55c150d0e04b190accaebecc23176aaac457ddd66f` | MCP image content；perceptual hash `f1708e8f71708a8f` |

#### Agent 两遍评价

需求与硬约束：

- Q0 通过：事务、validation、render 和 preview 均对应 revision 2/attempt 1。
- 英文固定文案完整存在于两个 Text 节点中；纯文字、无资产、排版艺术和 notice
  方向成立。
- Q1 未完全通过：中心 `PEE` 在右边界被裁切；环形文字全部进入画面，但顺时针
  阅读起点和方向不够明确，固定文案无法被顺畅完整读取。
- 按 B 的停止规则，不以第二次事务校正中心尺度或圆周阅读。

审美质量：

- 中心大字与环形小字形成明确的第一/第二层级，整体像印章或公共设施标识，明显
  弱化了信件感。
- `AMENITY` 语义与标识视觉的组合产生了比解释性通知更强的荒诞反差。
- 暖白、警示橙红和近黑的角色清晰，缩略图下仍能识别中心意象。
- 主词右侧裁切缺乏足够的对应关系，看起来更像失控而不是有意出血。
- 环形字符在中心右侧与大字发生碰撞，圆周阅读方向也使完整 notice 功能减弱。
- 相比 A 形成了更自洽的视觉概念，但仍未达到内容完全清晰和工艺完成的硬门槛。

#### 人类反馈

按条件规则不修订 B。项目所有者在 A/B 均完成后提供的比较反馈见 A 记录；该反馈
不用于回改 B。

#### 最终结果

- Final revision：`2`
- 停止原因：达到 B 的预注册停止规则——第一张准确 revision preview；未因质量问题修订
- Tool calls：7
- Transactions：1 committed + 1 dry-run
- Feedback rounds：0
- Failures/conflicts/reverts/retries：0；记录中心裁切和圆周阅读两项未修正问题
- 总时长：65 秒

### AE-20260728-S1-brief-pilot-C-R1

#### 环境与基线

- 开始/结束时间：2026-07-28 21:45:30 PDT / 尚未结束
- Agent：Codex desktop；当前任务可见的精确模型版本未提供
- MCP/capability：Companion `0.0.1`；protocol `1.0`；31 node types
- Scopes：read、preview、edit
- Baseline revision：`2`
- Baseline layers：`layer_1` hidden；`layer_2` 为 A hidden；`layer_3` 为 B
  visible，开始 C 事务时切换为 hidden
- 与预注册的偏离：

#### Agent 执行前解释与策略

本条件在写入前向项目所有者展示并确认。

状态：**已由项目所有者确认，并按 revealed A/B feedback 修订**

- 目标复述：做一件贴在公共空间里的 typographic object；没有发送者、称呼或解释
  段落，但第一眼仍能作为 notice 被感知。
- 语义结构：把固定句子变成五个视觉拍点：
  `DOG PEE` / `IS NOT AN` / `AMENITY.` / `NOT HERE.` / `NOT AGAIN.`
- 核心取舍：不把 `DOG PEE` 做成唯一最大标题；让语义上最荒诞的 `AMENITY.` 成为
  最大、最不合比例的视觉重音，使幽默来自“公寓配套设施”语言被夸张占据。
- 构图：竖向但偏轴的五段式构图；保留大块主动留白；后两句形成两个分开的停止拍，
  避免传统标题 + 正文 + 落款结构。
- 字体：使用会话固定字体，以尺度、字重、位置和轻微形变建立角色；不假装选择了
  不可用的字体。
- 色彩：高亮酸性黄绿色背景、近黑主文字、橙红色 `AMENITY.`；颜色只服务于语义
  重音和远距离识别。
- 形变：只对 `AMENITY.` 使用受控的轻微波形，使“设施”一词显得不稳定；其他文字
  保持硬朗，避免整张图变成效果演示。
- 内容门槛：所有单词必须完整进入画面；夸张可以接近边界，但不接受无意裁切。
- 预览后流程：先进行需求/硬约束检查，再进行审美检查；随后向项目所有者展示 C 的
  preview，并按“保留/改变/原因/最高优先级”最多修订两轮。

项目所有者看到 A/B 后尚未确认以上策略，并给出非技术审美判断。Agent 对该反馈的
待确认翻译是：

- **保留 A 的关系**：平面、直接、网格式单词节奏、超大文字、高亮底色与近黑字的
  强对比，以及“先像一张排版海报，再像 notice”的感受；
- **改变 A 的问题**：所有单词完整进入画框；让边缘、列宽、留白和每一拍之间的
  关系看起来经过控制，而不是意外溢出；
- **避免 B 的关系**：不使用圆形徽章/印章式构图，不让装饰性概念压过阅读，不让
  字符轨迹与主文字碰撞；
- **对“B 很怪”的当前解释**：怪主要来自圆周阅读、中心碰撞和过强的图形 gimmick，
  而不是用户拒绝所有夸张或荒诞；
- **C 的建议最高优先级**：沿 A 的视觉语言向前发展，但把画框、阅读节奏和
  `AMENITY.` 的夸张层级做得更有意图。

以上是 Agent 对审美判断的翻译，不视为已确认的用户要求；须由项目所有者确认或
纠正后再进行 C 写入。

项目所有者确认：

> 按这个做C

确认后的 C 执行取舍：

- 继承 A 的平面、直接、网格式节奏、高亮底色和近黑文字；
- 不采用原提案或 B 的环形徽章构图；
- 把固定文案拆成五个独立、可控制边界的语义短语；
- `AMENITY.` 保持最大荒诞重音和唯一橙红色文字，并使用轻微波形；
- 其余短语形成偏轴、逐段下落的阅读节奏；
- 首张 preview 后允许项目所有者最多两轮非技术审美反馈。

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |

#### Agent 两遍评价

需求与硬约束：

- revision 11 的第一版 Q0 通过但 Q1 失败：5 个短语参数完整，实际渲染因 `Place`
  offset 以文字起点定位而在右侧裁切。
- Agent 将其记录为空间语义判断错误，只调整 5 个 Place 的横向 offset，不改变
  文案、颜色、层级、纵向节奏或效果。
- revision 12 的 Q0/Q1 通过：准确 render/preview，固定文案全部完整可见，frame、
  纯文字、无资产和 notice 要求均满足。
- hard-fix 不计为人类审美反馈轮。

审美质量：

- revision 12 保留了 A 的酸性底色、近黑粗字和平面直接性，同时消除了无意裁切。
- `AMENITY.` 的橙红、尺度和轻微波形成为最强语义反差，荒诞感来自词义与视觉重音，
  不依赖额外说明。
- 五段阅读顺序清楚，且没有标题/正文/落款结构；缩略图仍保留大词和色彩层级。
- 当前构图仍偏中心轴，原计划中的偏轴张力弱于预期；`NOT HERE.` 与 `NOT AGAIN.`
  的尺度和间距较规整，是否需要更强节奏留给项目所有者评价。
- 当前版本已达到可进行第一轮审美反馈的硬门槛。

#### 人类反馈

第 1 轮原始反馈：

> 嗯，感觉这次好了一些。
> 但是还是感觉画面没有那么协调，可能从位置，字体，对称 等方面。你觉得呢？

Agent 对该反馈的当前翻译（等待项目所有者确认后再写入）：

- **保留**：C 的整体方向相对 A/B 有改善；用户尚未指定必须原样保留的局部关系。
- **改变**：解决整体“不协调”，重点检查位置系统、字体角色和对称/平衡关系。
- **Agent 诊断**：当前同时存在三套未被明确组织的轴线——顶端 `DOG` / `PEE`
  左右分置，中段 `IS NOT AN` / `AMENITY.` 近似居中，底部两句先左后中；这使画面
  既不形成严格对称，也没有足够清楚的有意不对称。`AMENITY.` 与下方两句之间的
  留白明显大于其他节奏，底部视觉重量又不足，因此上下部分像两个系统。
- **字体限制**：当前 MCP 不允许 Agent 枚举或写入字体，只能使用已固定的
  `default`；本轮可调整字号、字重、形变和空间关系，但不能诚实地把“换字体”作为
  已完成的修正。
- **建议最高优先级**：先建立一套明确的两列网格和共同边线，使顶部左右分置、
  中部横跨、底部左右呼应都服从同一空间骨架；用光学平衡而非机械全居中来解决
  “位置 / 对称”造成的不协调。字体角色只做服务该骨架的尺度和字重校正。
- **暂不处理**：新增颜色、文案、图形装饰或另一种视觉概念。

当前反馈基线：原始 revision `12`；恢复后等价 revision `1`。已收到人类反馈轮：
1/2；尚未执行第 1 轮修订。

#### 修订及保留关系

#### 最终结果

- Final revision：
- 停止原因：
- Tool calls：
- Transactions：
- Feedback rounds：
- Failures/conflicts/reverts/retries：
- 总时长：

## 4. 评价

### 随机化映射

评价前生成并记录，评价完成前不向项目所有者展示。

### 盲测成对偏好

| 比较 | 选择 | 置信度 | 原因 |
| --- | --- | --- | --- |

### 维度评分

| Run | 需求符合度 | 信息层级 | 构图与空间 | 字体与文字 | 色彩 | 一致性 | 独特性 | 完成度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-R1 | | | | | | | | |
| B-R1 | | | | | | | | |
| C-R1 | | | | | | | | |

每个分数的可观察证据：

### Agent 与人类评价的分歧

## 5. 偏离、失败与混杂因素

- **盲评协议被破坏**：Agent 通过 Node REPL 检查 A/B MCP image evidence 时，工具
  结果在当前 Codex 界面可见，并带有 condition title；项目所有者在 C 开始前已看到
  且识别 A/B。
- 因此本 Session 预注册的“随机化中性标签盲测”主要结果已不可获得。后续评价必须
  标为 revealed/non-blind，不得与未来盲评合并。
- 项目所有者在 C 策略确认前提供了 A/B 比较反馈。若 C 使用该反馈，它测量的是
  “看过候选后的共同艺术指导流程”，不再只是原定义中的“结构化 Brief + 策略确认”。
- Pilot 继续的价值限于：发现协议问题、观察 Agent 如何把非技术审美判断翻译为
  可执行关系、记录 C 的协作修订过程。
- 正式比较需要新建 Session，并使用不会向项目所有者显示条件标签的独立证据收集
  流程。
- **MCP 会话连续性失败**：最初的官方 SDK Client 运行在任务内 Node REPL 子进程中；
  该子进程在 Agent turn 结束后被回收，Chrome 会话随之撤销，项目所有者无法再找到
  原窗口。一次 PTY 恢复尝试又因长 JSON 行被截断而在写入前终止。
- 经项目所有者重新批准后，Agent 改用仅监听 `127.0.0.1` 的持久 HTTP 控制桥连接同一
  生产 stdio Companion。新窗口从干净 revision `0` 开始，因此只按已记录参数恢复
  当前 C 反馈基线，没有重放 A/B 条件。
- 恢复事务为 revision `0 → 1`，随后 renderable validation 为 0 error / 0 warning；
  819 × 1024 preview 的 content hash 为
  `98e5023b73664b376c144f760e756f468784e6f81a042d9051192d268096113a`，与原始
  revision `12` 的 C hard-fix preview 完全一致，perceptual hash 同为
  `bb7a491f4e6183c4`。因此恢复不构成新的审美版本；恢复调用、revision 和事务不计入
  C Run 的成本或反馈轮数。
- 本次实测形成单独的
  [`Graphic Design MCP 实测交互反馈`](../MCP-UX-FEEDBACK.zh-CN.md)，将视觉边界、
  会话连续性、字体授权和人类指向反馈按责任层与优先级拆分。
- 项目所有者在 C 第 1 轮反馈后依据上述反馈升级了整个 MCP 项目；Git 从
  `76e8064` 变为 `ae13bfd`，增加 `Place` anchors、
  `gfx_measure_rendered_nodes`、Trusted Local 和 render-ready startup。该变化发生
  在看到 A/B/C 结果之后，改变了预注册控制变量，因此本 S1 在执行第 1 轮 C 修订前
  停止。后续定向改进移入
  [`AE-20260729-T6-anchor-measured-revision`](./AE-20260729-T6-anchor-measured-revision.md)，
  不把新结果并入原 A/B/C 比较。

## 6. 结论

### 本 Session 支持的结论

待完成。

### 本 Session 不能支持的结论

待完成。

### 对 Brief 写法的启示

待完成。

### 对 Agent 工作流的启示

待完成。

### 对 MCP/API 设计的启示

待完成。

### 下一步实验

待完成。

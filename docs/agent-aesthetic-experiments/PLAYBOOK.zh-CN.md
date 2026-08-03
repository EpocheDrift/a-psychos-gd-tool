# Agent × MCP 审美协作 Playbook

状态：**Active working playbook / evidence-limited / alpha Skill source**

版本：**0.3.0-alpha**

日期：**2026-08-03**

维护者：**项目所有者 × Codex**

规范来源：[`SPEC.zh-CN.md`](./SPEC.zh-CN.md)

## 1. 文档角色

这份 Playbook 把实验中出现的有效协作模式整理成可执行工作流。它服务一个核心目标：

> 让 Agent 通过可复查的人机协作过程，更稳定地收敛到项目所有者的目标审美，同时
> 知道为什么成功、哪些质量可以检查、何时应由人判断、何时应该停止。

它不是通用“好看公式”，也不表示当前 alpha Skill 已经获得稳定性验证。

- **Spec** 定义研究问题、实验纪律、评价方法和记录要求；二者冲突时以 Spec 为准。
- **Playbook** 定义一次真实协作中，人、Agent 和 MCP 默认怎样工作。
- **Session** 保存每次实验的预注册、原始反馈、视觉证据、偏离和结论。
- **alpha Skill** 把当前 Working rules 封装成可用、可测试的协作对象；它必须显式标注
  evidence-limited，不能把当前作品的视觉风格固化，也不能声称已通过正式晋升门槛。
- **正式晋升** 只允许增强已经被后续跨任务与重复实验支持的 claim；创建 alpha 本身不等于
  通过晋升。

## 2. 当前证据边界

Playbook v0.3.0-alpha 的证据仍来自两个真实内容项目、六份 Session 记录：

1. 纯文字公寓 notice：
   - [`S1 Brief pilot`](./sessions/AE-20260728-S1-brief-pilot.md) 暴露 blind protocol、
     裁切、坐标语义、会话连续性和字体能力问题；
   - [`T6 anchor measured revision`](./sessions/AE-20260729-T6-anchor-measured-revision.md)
     验证空间骨架、painted-bounds anchors 和 preview 前 measurement；
   - [`T5 two kinds of cool`](./sessions/AE-20260731-T5-two-kinds-of-cool.md) 把“创意、
     酷、独到”拆成两套相反 art direction，并得到双方案接受；
   - [`poster recovery`](./sessions/AE-20260801-poster-recovery.md) 证明同一环境中可从记录
     确定性重建 accepted variants，但它只支持工程恢复，不支持审美稳定性。
2. 摄影主导的 Seattle serial poster：
   - [`T3/T4 prototype`](./sessions/AE-20260801-T3-T4-seattle-roaming-serial.md) 从两条
     art direction 中获得 B 的 revealed 选择，并澄清内容应保持非线性变化；
   - [`T4 migration`](./sessions/AE-20260801-T4-seattle-nonlinear-fragments.md) 把选择的视觉
     语法迁移到四张照片，再以单变量 title-topology refinement 获得整体接受。

因此当前证据比 v0.1.0 多支持一项：这套流程已在两个真实项目中产生有价值结果，并观察到
一次从纯文字 notice 到摄影系列的跨媒介迁移。但所有审美条件仍基本为 `n=1`，且来自一名
人类评价者、一个 Agent 和一个 default-font 环境；它尚未证明重复运行、跨评价者、跨模型、
跨字体或真实发布环境中的稳定性。

v0.3.0-alpha 没有增加新的审美证据。它只改变产品化顺序：先创建一个明确受限的
`collaborate-on-graphic-design` v0.1-alpha 作为实际使用与 eval 对象，再由后续实验修订；
Phase 2 不再是“允许开始写 Skill”的前置许可，而是检验该 alpha 的正式证据阶段。

当前证据分层：

- **工程可靠性较强**：exact revision、render、measurement、asset、hash 与恢复可复查；
- **审美协作可收敛**：两个项目均出现人类明确接受，但仍属于少量真实案例；
- **输出稳定性未知**：没有正式条件完成三次独立干净重复，也没有可报告的质量方差。

本文使用三种成熟度标签：

- **[Observed]**：已在当前案例中观察到，不代表普遍规律；
- **[Working rule]**：有案例证据支持，默认采用，但必须继续记录反例；
- **[Hypothesis]**：合理但尚未获得足够实验支持。

## 3. “稳定审美”的工作定义

本项目追求的不是 Agent 独立生成客观上 universally good 的设计，而是：

1. **意图稳定**：不同 Run 都能准确保持使用场景、内容、语气和人类真正重视的关系；
2. **工艺稳定**：不靠人类发现缺字、裁切、旧 revision、错 frame 等可自动检查问题；
3. **审美可收敛**：抽象反馈能转化为可讨论的设计关系，并在有限轮次内接近接受阈值；
4. **方向不坍缩**：稳定性不等于每次都生成同一种极简、大字、黑白或单色强调模板；
5. **系列稳定**：共享关系角色保持可识别，同时允许每个成员响应自己的内容与视觉结构；
6. **过程可解释**：能区分结果来自 Brief、概念、MCP 能力、人类判断还是偶然性。

稳定性必须通过不同任务和重复 Run 观察方差，不能由一张成功作品宣称。

## 4. 人、Agent 与 MCP 的责任

### 人类负责

- 使用目的、真实场景和不可接受的语气；
- “这是我想要的感觉吗”的最终判断；
- 候选之间的取舍、阶段性接受阈值和停止决定；
- 提供不必技术化的真实反馈，包括“不协调”“太像通知”“不够酷”；
- 本地字体、隐私资产和高风险权限的可信批准。

人类不需要知道 node id、offset、anchor 或 transaction 参数，才能提供有效审美反馈。

### Agent 负责

- 把感受词翻译成层级、空间、尺度、节奏、重心、张力和形式规则；
- 区分探索、定向 refinement、工艺修正和生产交付；
- 在写入前说明关键假设、设计策略和本轮不解决的问题；
- 展开差异充分的候选，而不是同一模板的浅表变体；
- 使用 MCP 证据排除工程缺陷，再进行审美自评；
- 原样保存人类反馈，不用自己的解释覆盖它；
- 已达到目标或目标发生性质变化时停止，不无限微调。

### MCP 负责

- capability、document、revision、transaction 和 render 的真实状态；
- 原子写入、schema 校验、结构化错误和冲突保护；
- exact-ticket validation、render、preview 和 rendered-node bounds；
- 提供控制与证据，不宣称视觉结果“好看”。

MCP 的 geometry 可以证明 inside、overflow 和几何中心，不能证明光学中心、独特性或
目标审美已经达到。

## 5. 先判断当前处于哪种工作模式

Agent 在设计前必须选择一种主模式；模式改变时应明确告诉人类。

| 模式 | 适用信号 | 默认动作 | 不应做什么 |
| --- | --- | --- | --- |
| Exploration | “不知道怎么搞”“不够酷”“想更有创意” | 将抽象词拆成 2–3 条差异充分的审美轴 | 直接猜唯一风格或像素级微调 |
| Direction selection | 人类想同时看看两种感觉 | 固定共同约束，并行生成不同组织原则 | 看完第一版后偷偷让第二版收敛 |
| Refinement | “整体不错，只是这里不协调” | 诊断一个最高优先级关系，保留已确认部分 | 借局部反馈重做整张作品 |
| Series adaptation | 已接受单张/系统，需要迁移成系列 | 声明 protected / invariant / adaptive，再逐张响应内容 | 复制像素坐标，或为变化而随机移动 |
| Craft correction | 缺字、裁切、旧 preview、边距错误 | 使用 MCP measurement 和 exact revision 修正 | 把工程错误包装成审美选择 |
| Recovery | “恢复原项目”“不要改设计” | 重放已验证 artifact，并比较结构、bounds 与 hash | 重新审美设计或肉眼调参逼近旧结果 |
| Production/context | 设计已被接受，需要打印或进入现场 | 验证媒介、距离、色彩和导出 | 继续无目标增加设计 revision |

**[Observed]** M 解决协调后，人类提出“创意、酷、独到”，这不是最后一轮位置微调，
而是从 Refinement 切换到 Exploration。另建 Session 保住了问题边界。

**[Observed]** Seattle R1 中，人类完整接受了照片理解与小字系统，只指出四张大标题固定
左上/右下带来的 template 感。R2b 保留已确认关系，只改变 title topology 后获得整体接受；
这再次支持 Refinement 应锁定已接受部分，而不是借局部反馈重做整套系统。

**[Working rule]** 系列任务开始时先分别声明：

- **Protected**：Brief 明确要求不可改变的内容、资产、主体和主视觉区域；
- **Invariant**：持续承担系列身份的语义角色、层级、字体/色彩角色和节奏原则；
- **Adaptive**：需要根据每张内容改变的位置、alignment、尺度、密度、文案长度、阅读向量
  和图文关系。

一致性来自共享的视觉 grammar，不要求主要元素复制同一像素坐标。该规则目前只在一个
摄影系列中得到正面观察，后续仍需记录失效案例。

## 6. 标准协作流程

### 6.1 捕捉意图

至少确认以下内容；不要求人类一次写成专业 Brief：

```text
场景与观看者：
希望对方先感到什么、再理解什么、最后做什么：
必须出现的完整内容：
更像什么 / 更不像什么：
希望保留的关系：
当前最不满意的感受：
Agent 可以大胆解释的范围：
什么现象出现时就算“目前够好”：
```

Agent 应从对话中补齐这些信息，不要把模板当成问卷一次性扔给用户。

### 6.2 复述而不是复写

执行前，Agent 用自己的语言输出：

1. 使用目的和观看顺序；
2. 硬约束；
3. 对审美词的视觉关系解释；
4. 关键设计动作及其原因；
5. 能力限制；
6. 本轮明确不解决的内容。

人类确认的是“你是否理解我”，不是技术参数。

### 6.3 选择单方案或多方向

- 反馈指向明确关系时，默认做一个定向修订；
- 抽象形容词仍有多种合理解释时，默认提供两个组织原则真正不同的方向；
- 候选差异必须存在于构图规则、阅读节奏或视觉张力，不能只换颜色、字号或效果；
- 比较实验应在看到任一结果前固定各候选条件；非实验协作也应避免先完成一个方向，
  再把后续方向无意识修成相似结果。

系列设计还应在执行前写出 `Protected / Invariant / Adaptive` 清单。若多张作品的突出元素
全部使用相同 anchor、相同阅读向量和相同密度，应把它标记为 template 风险；但不能为了
变化而变化，每个自适应动作仍需响应该张内容、图像结构或观看节奏。

**[Hypothesis]** 先在代表性素材上选择系统，再迁移到整组，可能减少方向性返工。Seattle
提供了一次正面案例，但尚未与“直接设计整组”做正式比较。

系列分支的参考顺序；代表性原型不是必经步骤：

```text
确认顺序是否代表时间线
→ 若存在能覆盖主要结构风险的代表性素材，可先做原型；否则直接预注册整组
→ 声明 Protected / Invariant / Adaptive
→ 逐张响应内容或图像结构
→ 单张 thumbnail + 同尺度 series contact sheet
→ 大图检查工艺
→ 只修改人类指出的最高显著性关系
```

### 6.4 先排除硬错误，再评价审美

顺序固定为：

```text
内容与 frame
→ exact revision / render
→ 节点边界与意外裁切
→ 缩略图层级
→ 大图字体与工艺
→ 构图、光学重心和节奏
→ 形式是否服务意图
→ 人类是否达到接受阈值
```

前一层成功不能替代后一层判断。

### 6.5 有限反馈

Agent 将人类反馈翻译为：

```text
保留什么关系：
改变什么关系：
人类给出的原因：
本轮唯一最高优先级：
参数由 Agent 决定的范围：
目标变化是否需要新 Session：
```

除非人类明确推翻方向，每轮只处理最高优先级问题。

### 6.6 停止

出现以下任一情况就停止当前方向：

- 人类明确说“现在对我已经好”“达到当前要求”；
- 预注册反馈或 revision 预算用完；
- 新反馈从工艺问题变成新的概念目标；
- capability、字体、文案、frame 或资产条件改变；
- 继续修改只是在追逐无定义的满分，没有新的可观察验收信号。

**[Observed]** N 与 U 都被接受时，没有必要制造一个虚假的冠军，也不应为了继续实验
而磨平两者的差异。

## 7. 怎样把审美语言变成设计关系

### 感受 + 关系 + 原因

人类最有价值的反馈不一定含有参数。Agent 应优先寻找三部分：

1. **感受**：现在看起来怎样；
2. **关系**：可能是哪些元素之间的问题；
3. **原因/目标**：为什么这会偏离想要的感觉。

本案例中的翻译：

| 人类原始表达 | Agent 可操作的关系 | 不能草率等同为 |
| --- | --- | --- |
| “不像信件，更像排版艺术，但仍是 notice” | 去主体/落款；以尺度、节奏和公共空间可读性承担通知功能 | 单纯把正文变大 |
| “不协调，可能从位置、字体、对称” | 共同轴线、成对视觉宽度、垂直拍点、字体角色和主动留白 | 全部机械居中 |
| “句号让视觉中心偏左” | 区分字符串 bounds 与 ink mass；做 optical compensation 或拆分标点 | measurement 错误 |
| “不够创意、酷、独到” | 进入概念探索；定义不同的秩序/压力关系和内容相关形式规则 | 再加 warp、旋转或装饰 |
| “两种都试试” | 固定共同约束，并行展开两个组织原则 | 用户拒绝做决定 |
| “两张现在对我都好” | 达到阶段性接受阈值，停止设计写入 | 必须继续选唯一胜者 |
| “非线性就很好” | 明确编号只表示陈列顺序；允许日期和移动片段并置 | 替用户虚构一条连续时间线 |
| “小字都保留，只让标题更变化、更少 template” | 冻结照片、内容、字体/色彩角色与次级排版，只改变一个高显著性空间关系 | 重做整组或随机移动每张位置 |

### 不要让人类被迫技术化

Agent 可以在内部把“不协调”翻译成 `anchorX`、painted width 和 offset，但向人类解释
时仍应使用“共同列中心”“底部重量”“视觉中心”等设计关系。参数是执行细节，不是
获得有效反馈的入场券。

## 8. 审美质量的四层闸门

### Gate A — 执行可靠性

- transaction 对应预期 revision；
- validation、await render、measurement 和 preview 使用同一 exact ticket；
- schema failure、retry、revert 和 conflict 均被记录。

### Gate B — 需求符合度

- 文案、标点、frame、资产和不可改变项正确；
- 第一/第二/第三阅读层级在缩略图中仍可辨；
- 语气和使用场景没有被形式牺牲。

### Gate C — 审美与工艺

- 边界是有意还是意外；
- painted bounds 的几何关系是否合理；
- 光学重心是否需要补偿；
- 字号、字重、行长、留白和节奏是否形成同一视觉语言；
- 效果是否有目的，还是为了显得“设计过”。

### Gate D — 意图与独特性

检查三个问题：

1. 核心形式动作是否来自本内容的语义或使用场景？
2. 在缩略图中是否存在一个可记忆、可描述的组织原则？
3. 如果把文案替换成任意标题，设计是否仍同样成立？

第三题若答案是“是”，结果可能只是一个完成度不错的模板。它不必立刻被否决，但
Agent 必须把“模板化风险”说清楚。

系列任务再检查：

1. 系列身份来自可说明的关系角色，还是只来自复制坐标？
2. 每张变化是否响应自身内容或构图，而不是随机制造差异？
3. 主要差异在同尺度缩略图/contact sheet 中是否可感知？
4. 如果变化只存在于缩略图中不可见的 metadata，整组是否仍会被读成同一模板？

最终 Gate 是人类的阶段性接受。Agent 分数是诊断，不覆盖人类偏好。

## 9. 保持方向差异，避免安全模板

### 不应被固化的表面风格

当前案例中的酸性黄色、大号粗体、近黑主字、橙红强调、两列、独立句号、斜向碰撞、
暖灰白文字、边缘标题、角落 metadata、对角线/上下居中/顶部阶梯、摄影暗部排字和黑边，
都属于作品级选择，不是 Playbook token。

alpha 与后续 Skill 版本不得默认：

- 大字 + 单色背景 + 一个强调色；
- 所有海报都使用中心构图或瑞士网格；
- 用 warp、rotation、grain 或 brutalism 自动代表“创意”；
- 只生成“高级、极简、安全”的结果；
- 把 Agent 熟悉的能力边界误写成用户的审美偏好。

### 候选差异检查

两个方向至少应在以下项目中的两项不同：

- 阅读路径；
- 对称/偏置；
- 密度与留白；
- 尺度分配；
- 秩序与破格比例；
- 平面/空间感；
- 语义形式规则；
- 情绪强度。

只换颜色、字体或效果不算独立 art direction。

## 10. Graphic Design MCP 操作清单

实验性设计写入继续严格遵守 Spec。默认顺序：

1. `gfx_get_capabilities`；
2. `gfx_get_document`，记录 revision、frame、layers；
3. 预注册 Session；
4. 使用稳定 request ID 执行 `gfx_apply_transaction(dryRun=true)`；
5. dry-run 后再次执行 `gfx_get_document`；若 revision 或相关状态变化，先理解介入编辑，
   再用新 request ID 和最新 revision 重做 dry-run；
6. 用新 request ID、最新 `expectedRevision` 提交同一语义计划；
7. `gfx_validate_document(source=current, mode=renderable)`；
8. `gfx_await_render` 等待提交对应 revision / attempt；
9. preview 前测量关键 `Place.out`；
10. 只有 measurement 发现的意外裁切可以触发预注册技术修正；
11. 捕获约 1024 px 大图和约 256 px 缩略图；
12. 先 Q0–Q1，再做审美批评；
13. 系列任务为每个成员保存 exact preview，并用同尺度 contact sheet 检查整组；若由
    Agent 侧拼合，记录每个源 preview 的 revision 与 hash；
14. 原样记录人类反馈、revision、hash、失败和停止原因；
15. 接受版本形成最小 reconstruction package：portable project 或 transaction plan、
    asset hashes、capability/environment fingerprint、最终 layer state 与 large/thumb evidence。

### MCP 证据的正确用法

| 证据 | 可以支持 | 不可以支持 |
| --- | --- | --- |
| validation | 文档结构/渲染条件有效 | 构图好看、文案视觉完整 |
| rendered bounds | inside、overflow、几何中心 | 光学中心、遮挡、协调性 |
| preview hash | 结果身份确认、前后精确比较与恢复验证 | 单独使结果可重建、质量高低 |
| thumbnail | 第一眼层级与整体重心判断 | 字体边缘和细节工艺 |
| large preview | 字形、细节、光学关系判断 | 真实打印和现场效果 |

### 当前已知能力上限（2026-08-01 snapshot）

- Agent 不可枚举或写入本地字体；default font 的成功不能证明字体问题已经解决；
- Codex 尚未原生加载 `gfx_*`；持久 SDK bridge 已完成真实多轮工作，但仍是本地集成而非
  宿主原生 lifecycle；
- UI 可以导出当前 rendered revision 的 PNG 与 portable project，MCP 侧仍没有 export
  scope/tool；
- 单文档仍只有一个 frame；没有原生 multi-artboard 或 series contact-sheet preview；
- revision conflict 没有 bounded provenance，不能直接说明 revision 变化来源；
- selection 不通过 MCP 暴露，也没有 revision-bound comment pins；
- bounds 不提供 glyph/ink-mass optical center 或遮挡判断；标点、非均匀字形与图像对比仍需
  人类判断。

## 11. 失败与纠偏规则

- schema / dry-run 失败：保持设计意图不变，只修正参数表达，并使用新 request ID；
- revision conflict：重新读取 document 和目标关系，不盲目重放；
- baseline revision 与预注册不符：立即停止写入，做 read-only audit；内容若仍等价，以新
  Run 显式固定新 baseline，不能静默续跑旧 Run；
- session revoked：记录宿主/Companion 失败，恢复后重新做 preflight；
- preview 暴露意外裁切：只在允许的 technical-fix budget 内修正；
- preview 后发现新概念目标：停止当前 Session，保留结果，另建 Session；
- 人类反馈与 Agent 自评不同：保存两者，不把 Agent 分数改写成人类意见；
- Recovery：只重放已验证 artifact 并比较结构、bounds 与 content/RGBA hash；hash 不符时
  停止报告，不通过审美调参“看起来接近”；
- 协议被污染：继续结果只能标为 exploratory，不补写成正式比较。

## 12. 如何判断这套方法是否真的稳定

后续 Session 应分别观察：

- 同一 Brief 多次干净运行的质量与意图方差；
- 同一工作流迁移到不同任务族后的接受度；
- 不同审美方向是否仍保持真实差异；
- 首张合格 preview 前的失败、技术修正和人类介入；
- 从模糊反馈到可执行关系所需的对话轮数；
- 人类否决、局部保留、双方案接受和提前停止的真实分布；
- Agent 自评与人类判断在哪些维度经常分歧。

不要只保存成功结果；失败案例是后续 Skill 版本避免过拟合的主要依据。

当前成熟度矩阵：

| 稳定层 | 当前证据 |
| --- | --- |
| 同环境工程重建 | 1 次 exact recovery，通过 |
| 人机协作收敛 | 2 个真实项目均获得明确接受 |
| 跨媒介迁移 | 初步观察到：纯文字 notice → 摄影系列 |
| 同 Brief 重复方差 | 无；正式 `n=3` 尚未开始 |
| 跨用户 / 模型 / 字体 / capability | 无 |

## 13. Alpha Skill 与正式晋升门槛

### 当前结论

**现在创建明确标注为 provisional 的 v0.1-alpha，但不把它称为已验证或稳定的正式
Graphic Design aesthetic Skill。** 当前已有两个独立真实项目和一次跨媒介迁移，但没有
第三个独立任务、正式三次重复或独立 Skill eval。alpha 的作用是把 Working rules 变成可以
真实使用、暴露问题和接受 forward-test 的对象，不是把少量案例改写成普遍规律。

当前门槛状态：真实独立项目 `2 / 3`；正式三次重复 `0 / 1`；人类否决/失败案例、
style-agnostic 规则与“硬门槛 / 人类判断”区分已具备；Skill eval 与晋升批准尚未具备。

alpha 必须：

- 在 UI metadata、Skill 正文和交付说明中保留 `v0.1-alpha / evidence-limited` 边界；
- 只承诺执行可复查的协作流程，不承诺客观或普遍“好看”；
- 把普通制作协作与正式 experiment/eval 分开，不能强迫每个日常任务完整预注册；
- 不携带案例色板、字体、坐标、图像或表面风格 token；
- 把人类接受保留为最终审美 Gate，并允许多方案同时达到阶段阈值；
- 保存失败、缺能力和与人类判断不一致的行为，作为后续修订输入。

### 建议的最低晋升条件

在把 alpha 晋升为具有更强稳定性 claim 的版本前，至少应满足：

1. 覆盖 3 个明显不同的任务或任务族，而不是同一作品的连续修订；
2. 至少一个正式条件按 Spec 完成建议的 3 次重复，而不是只挑最好结果；
3. 至少包含一个人类否决或失败收敛案例，并据此修改 Playbook；
4. 核心规则描述的是协作与判断，不含当前海报的颜色、字体、网格或效果 token；
5. 能明确区分硬门槛、Agent 建议和必须由人类决定的项目；
6. 有一组可复查的 Skill eval：相同输入下验证内容正确、方向差异、证据完整、反馈聚焦、
   anti-template 和停止行为，不用单一“审美分”冒充质量保证；
7. 正式验证缺失 capability 时的诚实退化，并完成一次公开/合成素材上的确定性 recovery
   regression；当前 prepared suite 尚未包含可计入晋升证据的 recovery case，因此不能据此
   晋升；
8. 项目所有者明确批准把已验证流程升级为 Skill。

### alpha 当前编码的内容

- 判断 Exploration / Direction selection / Refinement / Series adaptation / Craft correction /
  Recovery / Production/context 模式；
- 从自然语言提取 Brief 与审美轴；
- 生成差异充分的候选策略；
- 执行 MCP preflight、exact render 和 measurement checklist；
- 两遍评价与反馈翻译；
- anti-template 检查和停止规则；
- Session 记录与 eval hooks。

alpha 不应声称保证“好看”，而应保证遵循一套 evidence-limited、可复查、能让人类有效
参与的审美收敛过程。只有被后续实验支持的部分，才可在晋升时改写为更强的验证 claim。

## 14. 下一项验证

迁移已有一次初步证据；下一瓶颈是**第三个真实任务上的重复性**，不是继续优化已接受海报。
详细准备方案见 [`PHASE-2-PLAN.zh-CN.md`](./PHASE-2-PLAN.zh-CN.md)。

- 选择真实的 **T2 信息密集活动海报**，作为第三个独立内容项目；
- 冻结同一 Brief、art-direction envelope、环境和工作流，进行 3 次干净独立 Run；
- 使用冻结的 Playbook v0.3.0-alpha 与
  `collaborate-on-graphic-design` v0.1-alpha，不在看到任一结果后修改核心条件或 Skill；
- 仍由人类自然描述需求，Agent 负责整理 Brief，而不是要求人类填完专业表格；
- 所有取得 exact preview 的计数 Run 用中性标签展示，不挑 best-of；若某个计数 Run 没有
  artifact，保留为失败且不补跑，pairwise 结果标记不可完整获得；
- 本轮测量的是 Frozen Packet 下的 first-pass / initial-output 稳定性，不把它解释为完整的
  反馈后协作收敛稳定性；
- 正式 `n=3` 结束后才允许把人类 refinement 作为独立 Run，不回写污染方差结果；
- 若要比较两个工作流，必须另行预注册为每个条件各 3 次，不能把本轮单条件重复冒充比较。

如果没有真实的 T2 需求，应等待一个真实任务，不为了填满实验矩阵捏造无意义 brief。

## 15. 版本记录

| 版本 | 日期 | 变化 | 证据状态 |
| --- | --- | --- | --- |
| 0.1.0 | 2026-07-31 | 从 S1、T6、T5 提炼首次操作性协作流程、质量闸门、anti-template 规则和 Skill 晋升门槛 | 单任务案例；待迁移与重复验证 |
| 0.2.0 | 2026-08-01 | 纳入 Seattle T3/T4 跨媒介系列证据、Series adaptation、Recovery、reconstruction package 与 Phase 2 重复性方案 | 两个真实项目、同一评价者、审美 Run 基本 `n=1`；待第三任务 `n=3` |
| 0.3.0-alpha | 2026-08-03 | 不增加审美证据；允许先创建 evidence-limited v0.1-alpha 作为真实使用与 eval 对象，并把正式实验改为后续校正而非创建许可 | 证据边界不变；alpha 尚未完成独立 forward-test 或 Phase 2 |

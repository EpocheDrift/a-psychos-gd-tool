# Phase 2 — T2 Frozen Brief × 3 Clean Runs

状态：**Preparation only / 尚未预注册 / 禁止 MCP 设计写入**

版本：**0.2.0-draft**

日期：**2026-08-03**

负责人：**项目所有者 × Codex**

规范来源：[`SPEC.zh-CN.md`](./SPEC.zh-CN.md)

执行工作流：[`PLAYBOOK.zh-CN.md`](./PLAYBOOK.zh-CN.md) v0.3.0-alpha

候选产品：[`collaborate-on-graphic-design`](../../.agents/skills/collaborate-on-graphic-design/SKILL.md)
v0.1-alpha

## 1. 文档边界

本文只准备下一阶段的实验骨架，不是 Session 预注册。当前还没有真实 T2 Brief、完整文案、
资产和冻结环境，因此：

- 不分配正式 Session / Run ID；
- 不声称研究问题、假设或条件已经由项目所有者最终确认；
- 不创建 MCP 实验图层，不上传资产，不产生设计 preview；
- 真实任务出现后，必须把具体内容填入 Session 模板并在第一笔设计写入前确认。

Spec 始终优先于本文；若二者冲突，以 Spec 为准。

## 2. 阶段目的

当前已有两个真实项目的一次性成功收敛，但没有同一条件的重复方差。Phase 2 使用第三个
真实内容项目——优先为 **T2 信息密集活动海报**——执行一个单条件、三次独立重复实验，
测量 Frozen Packet 下的 **first-pass / initial-output 稳定性**。

它回答：

1. 冻结的 Playbook v0.3.0-alpha 与 `collaborate-on-graphic-design` v0.1-alpha 的 Brief
   翻译、执行与硬质量闸门能否迁移到信息组织压力明显不同的 T2？
2. 同一冻结条件下，Agent 的需求符合度、审美质量和过程指标波动多大？
3. 稳定性是否以三个结果坍缩为同一安全模板为代价？

它不比较两个工作流，也不能证明 Playbook 优于未设置的 baseline。若未来比较两个条件，
应预注册为每个条件各 3 次，而不是把本实验事后改写成 A/B。

因为三个 Run 在首张 exact preview 停止、没有人类审美反馈，本实验不测量完整的人机协作
收敛稳定性；反馈后的收敛方差必须由独立 follow-up 验证。

## 3. 待具体 Brief 激活的研究问题

- **RQ-P2.1 — 迁移**：冻结后的 Brief 翻译、initial generation 与硬质量闸门能否处理真实
  T2 的内容组织、三层阅读路径和审美意图？
- **RQ-P2.2 — 稳定性**：同一 Frozen Run Packet 在三个隔离上下文中运行时，需求符合度与
  审美质量的离散程度如何？
- **RQ-P2.3 — 非模板化稳定**：三个结果能否都符合意图，同时保留有意义的组织差异？
- **RQ-P2.4 — 过程方差**：首张有效 preview 前的时间、调用、technical fix 和失败是否稳定？

## 4. 候选假设；正式 Session 前锁定

- **H1**：三个 Run 都达到 `primary pass`：Q0 pass ∧ Q1 pass ∧ 项目所有者在
  Run-identity-blind 评价中认为无需另一轮概念性重做即可在真实场景中使用；
- **H2**：需求符合度和信息层级的 1–5 分在三个 Run 间 range 不超过 1 分；
- **H3**：至少两个 Run 在冻结的 variation axes 中至少两项被编码为不同，稳定性不表现为
  同一模板的浅表变体。

H1 是严格目标；失败仍是结果。任何差 Run、Q1 失败或被拒绝结果都必须保留，不补跑一张
更好的来替换。

H3 的 axes 在正式 Session 中完整冻结为：阅读路径、对称/偏置、密度/留白、尺度分配、
秩序/破格、平面/空间、语义形式规则、情绪强度。盲评前不参与设计的 custodian 按预先定义
的类别编码，并记录可见理由；只有类别不同且理由可观察时才算该轴不同，不能看完结果后
临时选择有利维度。

探索性分析问题：若出现明显优胜或失败 Run，人类 blind reason 能否与揭盲后的封存策略、
Brief 翻译或 trace 中至少一项证据对应？该问题不作为确认性假设。

## 5. Frozen Run Packet

真实 Brief 确认后，三个 Run 收到逐字相同的 Packet：

- 完整结构化 Brief 与全部固定文案；
- 第一、第二、第三阅读层级允许包含的内容组；
- 项目所有者在看到任何图像结果前确认的一条 art-direction envelope；
- frame、媒介、观看距离、缩略图和真实使用要求；
- 固定资产与 SHA、字体条件、色彩或品牌约束；
- 参考、参考原因、反例与避免项；
- Protected / Invariant / Adaptive；
- Agent 自由度、禁止项和接受信号；
- Agent 产品、模型和可见版本；若精确版本不可见，逐字记录不可见状态；
- Spec / Playbook / `collaborate-on-graphic-design` 的精确版本、Skill 文件 hash、允许加载的
  一层 references，以及会影响设计的 system/developer constraints；
- MCP Companion package、protocol、capability manifest、bridge 版本与 scopes；
- OS、浏览器、viewport 和与渲染相关的环境；
- baseline serialized/content hash、document ID、initial revision、frame 与完整 layer visibility；
- runner 是否可见之前 Session 文件；本实验固定为不可见；
- 固定运行顺序规则、候选数 `1`、human feedback rounds `0`、精确时间/调用/revision budget；
- 分开的 non-design recovery budget 与 design technical-fix budget；
- 相同证据流程、preview 尺寸、盲评和展示条件。

若审美意图仍有多种合理方向，应先只比较文字策略，由项目所有者在任何视觉 Run 前选择一条
方向并写入 Packet。三个 Run 不得各自选择不同 art direction，否则测试的是方向探索，而不是
同一条件的稳定性。

## 6. 三次独立性

每个 Run 必须：

- 使用新的隔离 Agent context，不继承另两个 Run 的对话、策略、节点或 preview；
- 使用同一 baseline 的独立克隆，frame、layers、asset hashes 与 baseline revision 等价；
- 只读取 Frozen Run Packet、Spec、冻结 Playbook 与冻结 alpha Skill package；不得读取另
  两个 Run 的文件或结果；
- 不知道自己是第几次重复，也不被提示“和前一张不同”；
- 独立记录并封存执行前策略、人类盲评前不得揭示；
- 只生成一个候选，不允许 runner 从内部候选中挑最好版本；
- 不接受任何人类审美反馈；
- 使用相同预算。

每个隔离 runner 必须自己完成 `解释 → 计划 → MCP mutation → evidence`。root/orchestrator
只能准备等价 baseline、逐字转发 Packet、执行预注册的密封/随机化流程和收集封存结果；不能
由已经看过前一张的 root 代替 runner 决定节点布局。三个 Run 默认串行执行，并使用物理隔离
的 writable document target；不得让并发 runner 共享同一个 active document。

任何已发生设计写入的 Run 都计入 `n=3`。只有第一笔设计写入前因 baseline 或环境不符而停止
的 attempt，才允许在保留记录后恢复重试。若 Agent、MCP、字体、capability、Packet、
Playbook 或 Skill package 在中途改变，停止 Session，不能把不同条件拼成三个重复。

若某个计数 Run 在耗尽预算后仍没有 exact preview：该 Run 作为技术失败保留并计数，不补跑；
H1 自动失败，H2 标记为不可获得，H3 只能作为剩余 artifacts 的部分诊断；只评价现有 exact
artifacts。三组 pairwise blind primary outcome 标记为 `incomplete / unobtainable`，不得用
空白占位或额外作品冒充第三个结果。

## 7. 每个 Run 的固定流程

1. Preflight：capability、scope、baseline revision、frame、layers、assets；
2. 独立生成并封存执行前解释与设计计划；
3. 完成一个候选；
4. exact validation、await render 与关键 bounds measurement；
5. 以相同尺寸捕获约 256 px thumbnail 与约 1024 px large preview；
6. 封存 Agent 两遍自评；
7. 到达第一组有效 exact previews 后停止，不做审美 refinement。

准备稿固定两类独立预算；正式 Session 可在看到任何结果前收紧，但不得放宽某一 Run：

- **Non-design recovery**：每个 Run 最多 2 次同语义 transport/schema/revision retry；必须
  0 design write，不消耗 design technical-fix transaction，但单独记录；
- **Design technical fix**：每个 Run 最多 1 次 committed transaction，只允许处理：

  - 与 Frozen Packet 明显矛盾的字面文案错误；
  - measurement 证实的非故意裁切或越界。

Design technical fix 只允许对故障节点做预先声明范围内的最小几何、缩放或断行修正；不得
改变整体构图原则、字体角色、色彩或概念。Q1 按最终进入盲评的 exact artifact 判断；首次
发现的 Q1 failure 仍作为执行/工艺缺陷记录。若发现错误后没有预算或修正仍失败，该 Run 以
Q1 fail 停止并计数。任一 recovery budget 耗尽也以失败 Run 停止。

## 8. Run-identity-blind 评价

这是单评价者、Run-identity-blind，不是双盲。

- 所有计数 Run 完成或按失败规则停止前，项目所有者不看画布、preview、策略或进度截图；
- custodian 不参与 Brief 翻译、策略或设计；在全部可用 artifacts 封存后、评价前生成并密封
  随机 label mapping 与展示顺序；
- 展示时隐藏 Run ID、生成顺序、revision、文件名和 Agent 解释；
- 所有可用 artwork 使用完全相同的尺寸、背景和缩放；
- 若任一结果提前暴露，原样记录 blind contamination，不静默补做。

评价顺序：

1. 按随机顺序一次只看一张 thumbnail，逐张记录第一、第二、第三注意到的信息；
2. 独立层级记录完成后，再看同尺度 contact sheet；
3. 按随机顺序看 large preview，回答“是否无需另一轮概念性设计，就愿意在真实场景中使用？”；
4. 完成 Spec 八项 1–5 分与逐项证据，不计算加权总分；
5. 按预先随机的 pair 顺序和左右位置完成三组 comparison，允许 A / B / tie，并记录置信度
   与理由；
6. 判断每张是否存在内容相关的可描述组织原则与 template 风险；
7. 保存人类原始反馈后再揭示映射、执行前策略与 Agent 自评。

若有计数 Run 没有 exact preview，只对现有 artifacts 执行可完成的评价步骤；pairwise primary
outcome 按第 6 节标记不可完整获得。

## 9. 结果与解释口径

主要结果：

- 三组 blind pairwise preference、置信度和开放理由；
- 三个独立的 `primary pass` 判断，其中
  `primary pass = Q0 pass ∧ Q1 pass ∧ blind conceptual-acceptance yes`；
- primary-pass 分布；另行报告纯人类接受分布，不能用它覆盖 Q0–Q1 failure。

解释口径在看到结果前固定：

- `3 / 3` primary pass：本冻结条件内观察到一致接受，初步支持 first-pass 稳定性；
- `2 / 3` primary pass：结果不一致，存在重要输出方差；
- `0–1 / 3` primary pass：本 Session 不支持 first-pass 稳定性。

这只描述单 Brief、单评价者、`n=3`，不得外推为普遍稳定。

次要结果：

- 八维原始评分与每维 range；可描述 mean / SD，但不宣称统计显著；
- thumbnail 阅读层级与 Frozen Packet 的对应；
- Q0–Q8 与 meaningful variation / template-collapse 判断；
- tool calls、transactions、revision 增量、technical fixes、失败和时长；
- human feedback rounds、Agent autonomous revision rounds；
- validation / render / transport failures、conflicts、retries 与 reverts；
- 人类直接指定参数/结构的次数；被保留、局部修正和整体推翻的决策；
- Agent 自评与人类评价的分歧；
- 三个封存策略之间的异同。

## 10. 停止规则

Run 级：

- baseline、Packet 或环境不符：零写入停止；
- 第一组有效 thumbnail + large preview 完成：停止；
- technical-fix budget 用尽：停止；
- Q1 失败仍保留并计入 Run，不因难看而重跑；
- 不因某张特别好或特别差提前结束。

Session 级：

- 三个计数 Run 完成后才进入 blind evaluation；
- mapping 揭示与原始反馈保存后，停止评价与设计写入；随后只完成 Spec §10H 要求的 final
  trace、评分、偏离、能/不能支持的结论和 Session 状态收尾；
- 文案、资产、方向、Agent、MCP 或 Playbook 改变时停止并保留已有证据；
- refinement 不得发生在揭盲和 Session 收口之前。

## 11. 正式启动门槛

真实任务出现后可以创建状态为 `Draft — not preregistered` 的 Session；以下条件全部满足并由
项目所有者确认后，才可标记为 `Preregistered / Active` 并授权第一笔设计写入：

- 存在一个实际要发布或使用的真实 T2 活动海报任务；
- 文案无 `TBD`：活动名、日期、时间、地点、节目/参与者、CTA 与必要署名齐全；
- 至少存在三个明确阅读层级和多个内容组，确实构成 T2；
- 项目所有者已确认 Agent 对需求、审美词、视觉关系和避免项的复述；
- 一条 art direction 已在看任何结果前选定；
- assets、授权、SHA 与字体条件明确；
- Frozen Run Packet、统一预算与 technical-fix budget 完整；
- 三份 baseline clone 通过只读等价检查；
- 隔离 runner、sealed evidence、随机标签与统一展示方式可执行；
- Playbook 与 alpha Skill package 的版本、文件清单和 hash 在 Session 前冻结，运行中不得
  修改；
- Session 模板的完整预注册区已填写并由项目所有者确认；
- 已同意“完成三次 blind evaluation 后再进入 production refinement”。

当前缺少真实 Brief，因此上述门槛尚未满足；本文件不授权任何 MCP 实验写入。

## 12. 与后续 refinement 的边界

Phase 2 三个计数 Run 的原始状态、可用 artifacts、hash 和评分在盲评后冻结。

- 若要把其中一张做成正式成品：以选中 Run 为继承 baseline，另建 T6/production Session；
- 若研究反馈后的收敛稳定性：另建 follow-up，并在看结果前决定是否向三个 Run 施加同一反馈；
- 只 refinement 获胜版本属于制作协作，不能用于证明三个原始 Run 都稳定；
- refinement 后的作品不得回填替换 Phase 2 原始结果或原始评分。

alpha Skill 可以在 Phase 2 之前用于普通真实制作、回顾性检查和非确认性 forward-test；这些
使用帮助发现产品问题，但不能预先阅读未来 T2 的密封 Brief 或三个 Run 结果。Phase 2
激活时必须冻结一个精确 alpha commit。看到任一计数 Run 后产生的 Skill 修订，只能进入下一
版本和后续实验，不能回写本 Session。

## 13. 激活时需要项目所有者提供的自然输入

项目所有者不需要填写专业表格；只需自然描述：

```text
这是一个什么真实活动，谁会在哪里看到？
希望第一眼感到什么，随后理解什么，最后做什么？
必须出现的完整文案与资产是什么？
它更像什么、更不像什么？
哪些内容或关系绝不能改变？
Agent 可以大胆解释到什么程度？
看到什么现象时，会觉得无需概念性重做即可使用？
```

Agent 负责把对话整理为完整 Brief、指出缺口、提出文字 art-direction envelope，并等待确认。

## 14. 版本记录

| 版本 | 日期 | 变化 | 证据状态 |
| --- | --- | --- | --- |
| 0.1.0-draft | 2026-08-01 | 建立第三任务、单条件三次独立 Run 的准备骨架 | 尚无真实 Brief，未预注册 |
| 0.2.0-draft | 2026-08-03 | 把冻结的 v0.1-alpha Skill package 纳入实验条件；允许在 Phase 2 前产品化，但禁止结果回写污染 | 尚无真实 Brief，未预注册；不增加审美证据 |

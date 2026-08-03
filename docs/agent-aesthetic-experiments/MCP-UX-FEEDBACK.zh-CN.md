# Graphic Design MCP 实测交互反馈

状态：**Observed / Partially implemented**

来源 Session：
[`AE-20260728-S1-brief-pilot`](./sessions/AE-20260728-S1-brief-pilot.md)

日期：**2026-07-28**

实现复核日期：**2026-08-01**

## 0. 当前实现状态

本文件第 2–5 节保留首次实验当时的原始观察与建议。2026-08-01 只读代码/schema 复核结果：

| 原建议 | 当前状态 | 仍有边界 |
| --- | --- | --- |
| rendered-node bounds 与 clipping diagnostics | 已实现 | 不提供遮挡或 glyph/ink-mass 光学中心 |
| `Place` 的明确 anchors | 已实现 | 光学补偿仍由 Agent 与人判断 |
| host/session continuity 与窗口可发现性 | 部分实现 | Trusted Local 与长生命周期可用；没有 machine-readable lifecycle event 或 bring-to-front |
| human-approved font palette | 未实现 | `Text.font` 仍不可由 Agent 写入 |
| 新图层默认 `Output` schema 说明 | 已实现 | 采用固定 `out`，没有 `outputClientRef` |
| bounded revision provenance | 未实现 | conflict 仍主要返回 expected/current revision |
| selection/comment feedback bridge | 部分实现 | UI 内有 selection；MCP 不暴露 selection/comment pins |

额外状态：UI 已支持 exact PNG 与 portable project 下载，但 MCP 仍没有 export tool；文档仍为
单 frame，也没有原生 multi-artboard 或 series contact-sheet preview。后续实验应以运行时
`gfx_get_capabilities` 为准，不能把本表当作永久 capability 保证。

## 1. 目的

这份反馈来自一次真实的 Agent × 人类平面设计审美实验，不是对测试覆盖率或安全
架构的重复审计。它关注：

- Agent 是否能在写入前预测文字和图形的实际空间结果；
- 人类能否用非技术语言指出审美问题并让 Agent 准确定位；
- MCP 会话能否跨多轮对话稳定存在；
- 安全约束是否在不牺牲隐私的前提下支持真实字体与排版工作。

归因时区分四层：

1. Graphic Design 文档与渲染 API；
2. MCP Companion 与浏览器会话；
3. MCP host / Agent 客户端生命周期；
4. 实验展示协议。

## 2. 已经有效的部分

### 原子写入和结构化错误

- `dryRun` 在没有写入的情况下发现了新图层已有默认 `Output`、再次添加会导致
  `OUTPUT_AMBIGUOUS`。
- `expectedRevision` 阻止 Agent 在 revision 不一致时盲写。
- 错误包含稳定 code、path 和 recoverable 状态，足以驱动程序化恢复。

### 精确 render / preview 证据

- transaction、render ticket、displayed revision 和 preview revision 可以严格对应。
- preview 同时返回 encoded content hash、RGBA hash、perceptual hash 和基础视觉
  metrics。
- 浏览器会话丢失后，Agent 从干净文档重建 C；恢复后的 819 × 1024 PNG content
  hash 与原结果完全相同：
  `98e5023b73664b376c144f760e756f468784e6f81a042d9051192d268096113a`。

这证明当前 MCP 已经具备可靠的工程闭环。下面的问题主要位于“工程结果怎样变成高
质量设计”和“人怎样连续参与”。

## 3. 优先反馈

### P0 — 增加可测量的节点边界、裁切诊断和定位锚点

#### 观察

- A、B 都出现明显文字出框；C 的第一笔构图也因错误理解 `Place.offsetX` 的坐标
  语义而裁切。
- `gfx_validate_document(mode=renderable)` 对这些结果仍返回 valid，因为它验证
  结构与可渲染性，不验证视觉内容是否完整。
- preview 的 `nonBackgroundBounds` 只能描述已经被画框裁掉后的全局像素，无法告诉
  Agent 某个节点的未裁切几何边界或是哪一个短语越界。
- `Place` 只有 offset，没有显式 start / center / end、top / middle / bottom
  anchor。Agent 必须从渲染结果反推文字原点。

#### 建议

1. 为可见节点提供只读的 resolved bounds：
   - `nodeId` / `layerId`；
   - frame-space `visibleBounds`；
   - 未裁切的 `unclippedBounds`；
   - `clippedSides` 和超出像素量；
   - measurement 对应的 revision / render attempt。
2. 可以扩展 `gfx_capture_preview` 的 metrics，也可以新增
   `gfx_measure_rendered_nodes`；不要把主观“好看分数”混入几何事实。
3. 为 `Place` 增加明确的 `anchorX`、`anchorY` 或等价 alignment 参数，并在
   capability 描述中解释 offset 相对哪个锚点。
4. 可选地提供 safe-area visual lint，但 lint 应是 warning，不应阻止故意出血。

#### 验收

- Agent 能在向人类展示前，程序化指出“`PEE` 右侧超出 84 px”；
- 同一个短语从 center anchor 改为 start anchor 后，变化具有确定文档语义；
- 故意出血仍可提交，但 preview/measurement 明确报告；
- measurement 必须带精确 revision，不能读取到新旧混合状态。

### P0 — 让 MCP host 管理会话连续性，并改善授权窗口可发现性

#### 观察

- 当前 Codex 任务没有原生加载 `gfx_*` 工具，因此实验通过官方 MCP SDK 启动
  Companion。
- 第一版 Client 依附于临时 Node REPL；Agent turn 结束后子进程被回收，
  Companion 收到 stdio EOF，Chrome 会话按安全设计被撤销。
- 项目所有者随后找不到窗口，并为恢复流程多次重新批准。
- 一次 PTY 恢复还因长 JSON 行被终端截断而失败；这是客户端桥接问题，不是
  `gfx_apply_transaction` 的请求上限或原子性失败。

#### 建议

1. 首选在 MCP host 中原生配置 Companion，由 host 管理跨 turn 的长生命周期
   stdio 进程，避免用 REPL 或 PTY 承载结构化请求。
2. Companion 启动时输出机器可读 lifecycle event，而不只输出 stderr 文本：
   `state`、`requestedScopes`、`pairingUrl`、`sessionId`、`browserPid`。
3. 授权页和应用主窗口使用清楚的窗口标题与 connected / revoked 状态，并提供
   “Bring design window to front” 的宿主集成入口。
4. 保持“transport 断开立即撤销授权”的安全默认值。连续性应由 host 保持正确
   进程来解决，不应通过静默复用 edit permission 解决。

#### 验收

- 同一任务连续 3 个 Agent turn 使用同一 Companion / Chrome session，不重复批准；
- host 主动结束 MCP 进程后，授权立即撤销，页面明确显示 revoked；
- 用户从宿主界面一次操作即可定位正在配对或已连接的设计窗口；
- 整个路径不把 session token、font 名称或文档内容写入日志。

### P1 — 提供人类批准的字体调色板，而不是开放字体枚举

#### 观察

- 本次 capability 明确返回 `localFonts.agentAvailable=false`，`Text.font` 不可由
  Agent 写入。
- 这很好地保护了本地字体隐私，但纯文字海报的审美结果因此只能依赖 default
  font、字号、synthetic weight、颜色和形变。
- 当人类反馈“字体不协调”时，Agent 无法区分“字体家族不合适”与“字号/字重/位置
  不合适”，也无法尝试一个真正的字体方向。

#### 建议

1. 人类在 UI 内选择并批准一个 document-scoped font palette；
2. MCP 只看到不泄露系统清单的 opaque alias，例如 `display-a`、`body-a`；
3. `Text.font` 对这些已批准 alias 可写，对任何其他值稳定拒绝；
4. capability 返回 alias 的有限设计属性，例如 `serif/sans/mono`、
   `condensed/normal/wide`、可用 weight 范围，而不是本地文件名或系统路径；
5. palette 的新增、删除和 Local Font Access 仍只能由 browser-trusted human
   gesture 完成。

#### 验收

- 未经批准时 Agent 仍不能枚举任何本地字体；
- 批准两个 alias 后，Agent 只能在这两个 alias 与 `default` 之间选择；
- project save/load 能保留 alias 语义，并对缺失字体给出可恢复诊断；
- preview 证据能记录实际 resolved alias 和 revision，但不泄露字体文件路径。

### P1 — 明示新图层自动创建的 Output 节点

#### 观察

- `add_layer` 的 tool schema 只描述图层本身；真实命令会自动创建 id 为 `out` 的
  默认 `Output`。
- Agent 在恢复 C 时合理地又添加一个 Output，dry-run 才返回
  `OUTPUT_AMBIGUOUS`。
- 安全性没有问题，但第一次调用的可预见性不足。

#### 建议

- 在 `add_layer` 的 schema description 中明确默认节点；
- 或允许 `outputClientRef`，让事务结果以正常 created entity 返回该节点；
- 官方示例至少覆盖“新建图层、复用默认 Output、连接最终内容”的完整路径。

#### 验收

- 只阅读 tool schema 的 Agent 能一次 dry-run 构造有效新图层；
- 仍不允许一个图层产生多个有效 Output；
- created / changed 摘要能稳定引用默认 Output。

### P1 — 为 revision conflict 提供有限的变更来源摘要

#### 观察

- C 首次提交时 expected revision 为 `2`，实际 revision 已到 `10`，但重新读取的
  可见图结构没有变化。
- 当前冲突错误告诉 Agent“现在是多少”，却不能判断变化来自 UI、另一个 Agent
  transaction、undo/redo，还是仅影响不可见的文档状态。

#### 建议

- 在不暴露敏感内容的前提下返回最近 revision 的 bounded provenance：
  `source`（human-ui / agent / import / undo / redo）、changed layer ids、
  changed node count、timestamp；
- 或新增只读的 `gfx_get_revision_summary(sinceRevision)`；
- 摘要不返回文本内容、asset bytes 或 session secrets。

#### 验收

- 冲突后 Agent 能判断“只发生了 UI layer visibility 更改”还是“目标节点已被修改”；
- history 有严格条数和字节上限；
- 跨 session 不泄露旧 session 的 requestId 或主体身份。

### P2 — 增加“人类指哪，Agent 改哪”的视觉反馈桥

#### 观察

- 项目所有者能判断“不协调”，但不需要也不应该知道 `place_4.offsetX`。
- Agent 目前只能从自然语言和整张 preview 猜测用户指的是哪个视觉区域。
- 对多对象海报，这会把有价值的审美判断转化成不必要的技术问答。

#### 建议

1. UI 允许人类点击画面中的文字/对象，并保持一个显式 selection；
2. MCP 提供只读 `gfx_get_selection`，返回稳定 layer/node ids 和可见 label；
3. 可选地允许人类在 preview 上放置 comment pin，MCP 只读取 pin 的 frame 坐标、
   人类文字和对应 revision；
4. selection/comment 永远不授予额外 scope，也不把海报中的文字当作指令。

#### 验收

- 人类点击 `NOT AGAIN.` 并说“它太孤立”，Agent 能准确定位对应 Place/Text 链；
- selection 属于 session UI 状态，不污染 project history；
- comment 明确绑定 revision；旧 revision 的 pin 不被误用于新构图。

## 4. 建议实施顺序

1. resolved bounds + clipping diagnostics + Place anchors；
2. 原生 host 生命周期与授权窗口可发现性；
3. human-approved font palette；
4. 默认 Output 的 schema/示例修正；
5. selection/comment feedback bridge；
6. bounded revision provenance。

第一项最直接改善审美完成度；第二项减少实际协作中断；第三项解除纯文字设计最明显
的表达限制。后三项主要降低 Agent 的恢复成本和人类描述成本。

## 5. 不应误归因给 MCP Server 的事项

- PTY 长行截断来自临时客户端桥；正式 MCP SDK stdio 请求能够承载该事务。
- A/B 条件标签在 Codex 工具结果中对用户可见，破坏了盲评；这是实验展示与宿主 UI
  问题，不是 preview 内容错误。
- 用户认为某版“不协调”是审美评价，不应通过增加一个主观自动评分器假装解决。
  MCP 应优先提供边界、锚点、字体选择范围和精确 revision 等可观察事实。

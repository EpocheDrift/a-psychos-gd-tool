# AE-20260801-T4-seattle-nonlinear-fragments — “漫游西雅图”非线性四张迁移

状态：**Complete — R2b 通过整体人类验收；revision 40 接受并停止**

Spec 版本：**0.1.0**

Playbook 版本：**0.1.0**

日期：**2026-08-01**

负责人：**项目所有者 × Codex**

## 1. 预注册

### 研究问题

- RQ1：胜出的 `Roaming Edges` 视觉语法迁移到四张构图不同的照片时，能否仍被识别为
  同一系列，而不是机械复制同一模板？
- RQ2：在文案保持原版简洁、editorial、路线/观察残片语气的前提下，每张改变标题与
  metadata，能否通过内容、字面长度和信息密度变化产生项目所有者所说的“刺激”？
- RQ3：Agent 按每张照片的真实暗部与边缘自适应位置，是否能同时保留摄影主导和 B 的
  左上/右下或相对边缘迁移关系？

### 假设

- H1：固定字体角色、标题重量、暖灰白文字、边缘迁移和系列索引，同时改变每张的观察
  词与 metadata，会比四张重复 `ROAMING SEATTLE` 更有节奏而不破坏系列身份。
- H2：只复制 B 的准确坐标会在三张 2:3 照片上失效；保留“相对暗部与相对边缘”比保留
  像素位置更能迁移该系统。
- H3：非线性组织允许照片来自不同日期，不需要伪装成一次按顺序发生的路线。

### 任务族

- 主要：**T4 同一视觉系统的系列变体**；
- 继承来源：`AE-20260801-T3-T4-seattle-roaming-serial` 中人类选择的 B —
  `Roaming Edges`。

### 固定任务与完整文案

四张不是时间线。`01 / 04`—`04 / 04` 只表示 carousel / 系列顺序，不表示拍摄先后。

**F1 — 城市夹缝 / 系列入口**

- source：`private-photo-F1`
- source SHA-256：`[公开仓库已脱敏；保留于私有封存证据]`
- 形态：约 3:4 竖幅；精确像素尺寸与 byte length 私有封存
- 文案：
  - `ROAMING`
  - `SEATTLE`
  - `CAPITOL HILL → PIKE PLACE`
  - `BUS + WALK`
  - `JUL 2026`
  - `01 / 04`

**F2 — 公交车窗 / 内外之间**

- source：`private-photo-F2`
- source SHA-256：`[公开仓库已脱敏；保留于私有封存证据]`
- 形态：2:3 竖幅；精确像素尺寸与 byte length 私有封存
- 文案：
  - `IN TRANSIT`
  - `SEATTLE`
  - `BUS WINDOW`
  - `BETWEEN STOPS`
  - `JUL 2026`（日信息在公开记录中脱敏）
  - `02 / 04`

**F3 — 天空、玻璃与混凝土**

- source：`private-photo-F3`
- source SHA-256：`[公开仓库已脱敏；保留于私有封存证据]`
- 形态：2:3 竖幅；精确像素尺寸与 byte length 私有封存
- 文案：
  - `PASSING`
  - `SEATTLE`
  - `SKY + CONCRETE`
  - `ON FOOT`
  - `JUL 2026`（日信息在公开记录中脱敏）
  - `03 / 04`

**F4 — 街面仰视**

- source：`private-photo-F4`
- source SHA-256：`[公开仓库已脱敏；保留于私有封存证据]`
- 形态：2:3 竖幅；精确像素尺寸与 byte length 私有封存
- 文案：
  - `LOOKING UP`
  - `SEATTLE`
  - `STREET LEVEL`
  - `ON FOOT`
  - `JUL 2026`（日信息在公开记录中脱敏）
  - `04 / 04`

### 条件

单条件迁移 Run：**Adaptive Nonlinear Fragments**。

- 继承 B 的视觉角色，不继承其准确像素坐标；
- 大标题保持 `font=default`、粗字重、圆钝/不尖锐的感知结果；长度较长时允许在预先
  声明的范围内缩小字号，但不得降级成 metadata；
- 每张的大标题两部分置于相对的暗边/阴影区，使阅读路径跨越画面；
- metadata 只进入照片已有暗部或边缘，不占用主要天空、车窗亮部或建筑主体；
- F1 保留已被选择的 B 关系；F2–F4 由 Agent 按各自构图自适应；
- 不加入地图、图标、色块、假坐标、假 UI、装饰线或新图像效果。

### 控制变量

| 变量 | 固定值 |
| --- | --- |
| Agent 产品/模型/版本 | Codex desktop；当前任务不可见精确模型版本 |
| MCP Companion/capability 版本 | package `0.0.1`；protocol `1.0`；Git `ae13bfd`；13 tools；measurement v1 |
| 浏览器/操作系统 | Chrome `151.0.7922.72`；macOS `26.5.2` (`25F84`) |
| Frame | 1080 × 1440；3:4；near-black canvas；四张统一 |
| 图片映射 | 完整 `contain`、居中；不裁切、不调色、不锐化、不降噪、不加图像效果 |
| 2:3 图片适配 | 保留完整画面，左右各约 60 px 安静边带；主文字仍锚定实际照片内容，不利用边带伪造暗部 |
| 字体条件 | `font=default`；标题粗字重；metadata 常规/中等字重 |
| 色彩 | 照片原色；文字 `#E9E7DE`；canvas near-black |
| 资产 | 上述四个固定 source；私有封存证据中的 SHA-256 用于实验内核验 |
| Scopes | read、preview、edit、assets；不启用 model |
| 初始文档 | revision 15 的继承 Seattle 文档；只新增 F1–F4 图层，保留且不修改 `Layer 1`、`A`、`B` |
| 候选数 | 4 张；每张 1 个预注册初稿，不为弱图额外生成候选 |
| 反馈轮数 | 首轮 0；人类看完四张后最多 2 轮，每轮只处理一个最高优先级关系 |
| 时间预算 | 无硬上限；记录实际时间与工具耗时 |

标题允许的适配范围：字重保持与 B 相同；字号约为 B 标题的 85%–110%，只用于适应词长和
照片暗部。metadata 的相对层级、暖灰白色和边缘角色保持不变。

### 主要结果

项目所有者看完四张并回答：

1. 四张是否明显属于同一系列；
2. 是否避免了“只是同一张模板换照片”的单调；
3. 哪张最强、哪张最弱，以及可观察原因；
4. 内容变化是否提供了合适刺激，还是破坏了安静的 profile 陈列感。

### 次要结果

- 每张内容、asset、frame、revision、render 与关键文字 bounds 是否正确；
- Agent 对摄影保留、标题角色、空间、系列一致性、独特性和完成度的两遍评价；
- 3:4 / 2:3 `contain` 差异是否产生不可接受的边带或弱化 full-bleed 感；
- 自适应位置是否比机械坐标复用更合理，但不把四张做成彼此无关的设计。

### 重复次数

本轮为迁移 Pilot：每张 1 个结果。不能支持稳定性或方差结论。

### 停止规则

- 第一笔设计写入前完成本预注册与 MCP preflight；
- source hash、尺寸、MIME 或初始文档条件不符时停止；
- 不覆盖前一 Session 或用户已有作品；
- schema、asset envelope 或 request 参数错误可使用新 request ID 修复，不改变文案与设计条件；
- 意外越界、缺字、未渲染可做每张最多一次最小 technical fix；
- 四张均获得 exact preview、0-error validation 和 inside measurement 后停止，等待人类评价；
- 看见 preview 后不为某一张做未预注册的审美美化；审美反馈属于后续 Run。

### 盲评方式

无盲评。四张按 `01 / 04`—`04 / 04` 交付；评价者知道它们共享 B 系统。

### 已知混杂因素

- F1 为 3:4，F2–F4 为 2:3；统一 frame 会产生不同的边缘条件；
- 四张内容、标题长度、拍摄日期与构图同时变化，本 Session 评价完整系列迁移，不作单变量
  文案因果推断；
- default font 仍不可枚举，圆钝感主要由大字号和粗字重产生；
- 四张只有一次 Pilot，不能证明 Agent 稳定地产出同等质量；
- 用户已经选择 B，因此本轮不是匿名 art-direction 比较。

> 完成本节后再进行第一笔 MCP 设计写入。开始时间：
> **2026-08-01 17:36:44 PDT**

## 2. Brief

### 目标

把四张来自西雅图公交/步行移动与观察的照片做成非线性 serial poster。它们是个人 profile
中的感知、生活、记忆与时刻切片，不讲述完整行程，不向观看者解释主体。

### 输出与场景

- 四张 1080 × 1440 prototype；
- Instagram profile / carousel；
- 本轮验证视觉系统迁移，不宣称最终 platform/export ready。

### 必须内容

- 四张照片完整保留；
- 使用本 Session 固定的英文文案；
- 每张出现 `SEATTLE` 和唯一系列序号；
- 文案变化但语气仍简洁、editorial、纪实；
- F1 保留已选择 B 的核心关系。

### 信息层级

1. 每张摄影画面；
2. 每张不同的观察标题 + `SEATTLE`；
3. 场景、移动方式、日期与序号残片。

### 审美意图

- 安静但不因重复而单调；
- 文字具有存在感但不变成旅游宣传或 caption；
- 标题圆钝、有重量、不尖锐；
- 刺激来自四张之间的语义、词长、密度与位置节奏，而不是粗暴效果或换风格。

### 视觉关系

- “同一系列”由字体角色、重量、颜色、边缘逻辑和索引建立；
- “每张不同”由标题、metadata 与对各自拍摄空间的响应建立；
- 文字跨越画面，但避开最重要的亮部/天空；
- 不把相同坐标当成一致性。

### 视觉参考及参考原因

只使用四张原始照片与已选择的 B preview 作为内部参考；参考 B 的标题角色和边缘迁移，
不把它的像素位置复制到所有照片。

### 反例与避免项

- 四张重复完全相同的 `ROAMING SEATTLE` 与 metadata；
- 四张只是换照片的模板；
- 四张彼此像不同项目；
- 旅游广告、景点说明、地图 pin、假 UI、伪坐标；
- 为“刺激”加入尖锐字体、噪点、色块、旋转或无来源机器感；
- 裁掉照片以迁就文字，或把文字放进主要天空/车窗亮部。

### 必须保留

- source 像素与原色；
- 每张主要构图、暗部与亮部关系；
- B 的大标题尺度角色、粗字重、较圆润/钝的感知结果；
- 摄影始终是语义主体。

### Agent 自由度

可在预注册范围内决定每张标题与 metadata 的具体边缘、alignment、字号和间距；不得改变
固定文案、照片、颜色、字体条件、frame 或核心边缘迁移逻辑。

### 验收信号

- 缩略图中四张首先仍是照片，但大标题能建立一致的系列拍点；
- 不看序号也能感到同一系统；细看时每张内容与空间关系不同；
- 所有文字完整、inside、可读，不遮挡主要亮部；
- 四张 0 errors / 0 warnings，exact preview 与 source evidence 可复查；
- 项目所有者认为变化提供刺激而没有变成喧闹或解释型设计。

## 3. Run 记录

### AE-20260801-T4-seattle-nonlinear-fragments-R1

#### 环境与基线

- 开始/结束时间：2026-08-01 17:36:44 PDT / 2026-08-01 17:45:21 PDT
- Agent：Codex desktop；当前任务不可见精确模型版本
- MCP/capability：package `0.0.1`；protocol `1.0`；Git `ae13bfd`；13 tools；
  `rendered-node-measurement-v1`
- Scopes：read、preview、edit、assets；Trusted Local；未使用 model
- Baseline revision：`15`
- Baseline layers：`layer_1 / Layer 1` hidden；`layer_2 / A` hidden；`layer_3 / B` visible；
  frame 1080 × 1440；只有 F1 source asset，SHA 与预注册相符且被 A/B 各引用一次
- 与预注册的偏离：预注册优先 revision 0 空白文档，但 preflight 发现的是预期的继承 Seattle
  文档 revision 15。因其中只有前一 Session 的 `Layer 1`、`A`、`B`，本 Run 改为新增 F1–F4
  图层并仅切换 visibility，不删除或修改旧层；研究问题、固定文案、主要结果与停止规则不变。

#### Agent 执行前解释与策略

- F1 复用 B 的关系作为系列入口；
- F2 利用公交车内上下大面积黑区形成“内/外”夹层；
- F3 利用顶部暗楔与底部建筑暗部跨越大天空；
- F4 利用四周建筑/树木围绕中央仰视轴，避免在天空中心放字；
- 先验证四张硬约束，再做缩略图系列判断；首轮不进行审美追修。

#### MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_get_capabilities` | `t4-preflight-capabilities` | sockets、params、traits | 成功；13 tools；所需 scopes 可用 | 15 | 7 ms |
| 2 | `gfx_get_document` | `t4-preflight-document` | frame、layers、nodes、edges、positions | 继承 Seattle 文档；A hidden / B visible | 15 | 4 ms |
| 3 | `gfx_list_assets` | `t4-preflight-assets` | 当前 manifest | 只有 F1 asset；SHA 与引用正确 | 15 | 2 ms |
| 4–8 | `gfx_put_asset` | `t4-f2-asset-*` | begin；3 chunks；finalize | durable；2:3；私有封存的 source identity 匹配 | 15→16 | chunks 59/42/22 ms；finalize 54 ms |
| 9–13 | `gfx_put_asset` | `t4-f3-asset-*` | begin；3 chunks；finalize | durable；2:3；私有封存的 source identity 匹配 | 16→17 | chunks 45/41/15 ms；finalize 52 ms |
| 14–18 | `gfx_put_asset` | `t4-f4-asset-*` | begin；3 chunks；finalize | durable；2:3；私有封存的 source identity 匹配 | 17→18 | chunks 40/43/38 ms；finalize 61 ms |
| 19–26 | `gfx_apply_transaction` | `t4-f[1-4]-design-{dry,commit}-v1` | 每张 48 commands；独立隐藏图层；同一结构、不同内容/位置 | 4 次 dry-run + 4 次 durable commit；0 warnings | 18→22 | dry 10/13/14/14 ms；commit 14/19/20/25 ms |
| 27 | `gfx_apply_transaction` | `t4-f1-show-dry-v1` | 试图同时设置所有 visibility | `INVALID_ARGUMENT`：一个 hidden layer 会保持 hidden；fail-closed，无写入 | 22 | 6 ms |
| 28–34 | switch / validate / await / measure / preview ×2 | `t4-f1-*` | 只切换 B→F1；6 个 `Place.out`；1024/256 previews | 0 errors / 0 warnings；6/6 inside；exact preview | 22→23 / attempt 1 | switch 26；validate 53；await 67；measure 2；preview 63/8 ms |
| 35–41 | switch / validate / await / measure / preview ×2 | `t4-f2-*` | F1→F2；6 个 `Place.out`；1024/256 previews | 0 errors / 0 warnings；6/6 inside；exact preview | 23→24 / attempt 1 | switch 21；validate 8；await 44；measure 1；preview 60/9 ms |
| 42–44 | switch / validate | `t4-f3-*` | F2→F3 后开始验证 | switch committed；首次 validate 命中 request-rate budget；文档不变 | 24→25 / attempt 1 | rate failure 1 ms |
| 45–49 | validate / await / measure / preview ×2 | `t4-f3-*-v2` | 对同一 revision 25 降速重试 | 0 errors / 0 warnings；6/6 inside；exact preview | 25 / attempt 1 | validate 6；await 2；measure 5；preview 102/24 ms |
| 50–56 | switch / validate / await / measure / preview ×2 | `t4-f4-*` | F3→F4；6 个 `Place.out`；1024/256 previews | 0 errors / 0 warnings；6/6 inside；exact preview | 25→26 / attempt 1 | switch 49；validate 14；await 4；measure 6；preview 107/21 ms |
| 57–58 | `gfx_get_document` / `gfx_list_assets` | `t4-final-*` | final frame、layers、assets 与引用 | revision 26；F4 visible；4 assets available；旧 A/B 保留 | 26 | 未单独记录 |

#### Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| F1 large | 23 / attempt 1 | 768 × 1024 | content `1d910028048518f74426a3564dde830d59ef83f03790886a059d3eabf6a564ab`；RGBA `5b28757fe7528019e9aa2bcc5bfad49107f908a69d56d53d23d977b3038a67da` | `test-results/agent-aesthetic/AE-20260801-T4-seattle-nonlinear-fragments/previews/t4-f1-preview-large-r23-1.png` |
| F1 thumb | 23 / attempt 1 | 192 × 256 | content `fe80b159a0d99b069ea1e541b59fe51d962b28afb253c9a748ec0e7d3f06b687`；RGBA `1e4483e9edb5aee4ef79834062226ecad857ccfc19bf853521225f67bea9293f` | `…/t4-f1-preview-thumb-r23-1.png` |
| F2 large | 24 / attempt 1 | 768 × 1024 | content `ea139973dfdd3632d8d3222eba96285d248abe571219c06d6efd1f6896777b59`；RGBA `6dcb29d1862993bac5506e881fe01d53449aa7a24e886f20bc661e431e69505a` | `…/t4-f2-preview-large-r24-1.png` |
| F2 thumb | 24 / attempt 1 | 192 × 256 | content `6cdfcbb1ee7bafd1c633b176b2b8e476f8e885bb2ed4f6334872b89c5060d90d`；RGBA `7f015250a4053ef4d2370b721897d2ca48ba1be9bcd4926ba6e69254c4f1a33d` | `…/t4-f2-preview-thumb-r24-1.png` |
| F3 large | 25 / attempt 1 | 768 × 1024 | content `7df4c4031967acc87361ff222badba62032c35b8a3bce510a2ac8bd237d98495`；RGBA `31406e9a174ea78ea1f3c46f0b129d77d5532ea39d5a762e2374c10334cc0c5d` | `…/t4-f3-preview-large-r25-1.png` |
| F3 thumb | 25 / attempt 1 | 192 × 256 | content `afba6f36676738ec4c020632ba20cbf71a44e940dc9f30771765ccd42c6a5578`；RGBA `c74d73f8ae0cc9b45b58051058442147d21699f416daa205e78399982fb15ae0` | `…/t4-f3-preview-thumb-r25-1.png` |
| F4 large | 26 / attempt 1 | 768 × 1024 | content `8160f473c39985f1bea8d5f7f989a1b49014dba45ce6d0ca6cd33af85cd073d5`；RGBA `179ea24d4c3e5e2a5f6c274f83404b041e59b9151ed8d2af2c46c0d14d12567b` | `…/t4-f4-preview-large-r26-1.png` |
| F4 thumb | 26 / attempt 1 | 192 × 256 | content `fda35710c3966acb7c8bd9a2b331ad2ab6bbd0916e222e5e00aa1836808d9f8e`；RGBA `c0e7a9049a712a97cabfad9b033fc9b8cd28ece8b5ad0191f470d57c7fcc1cbd` | `…/t4-f4-preview-thumb-r26-1.png` |

#### Agent 两遍评价

需求与硬约束：

- 四个 source 的 identity 与形态均匹配私有封存的预注册证据；F1 复用既有 asset，F2–F4
  通过 content-addressed upload durable 保存；
- 四张均为 1080 × 1440，Image `contain`，无裁切、调色、锐化、降噪或图像效果；
- 每张六条固定字符串完整出现；`SEATTLE` 与唯一 index 跨四张重复；
- 四张均 0 errors / 0 warnings；24/24 `Place.out` measurement 为 `inside`，无 overflow；
- F1 large/thumb hash 与前一 Session 的 B 完全一致，证明迁移入口没有静默变化；
- 最终 revision 26；F4 visible；旧 `Layer 1`、`A`、`B` 全部保留且 hidden。

审美质量：

- 缩略图下四张共享明确拍点：左上不同的大标题、右下稳定的 `SEATTLE`、边缘小索引和
  暖灰白文字。即使看不清 metadata，也能被识别为同一系列；
- 内容刺激主要来自 `ROAMING` → `IN TRANSIT` → `PASSING` → `LOOKING UP` 的词义、词长和
  大字宽度变化。F2 的公交横向窗口结构提供了最明显的节奏断点，不像单纯换背景；
- F1 的中央天空通道与左右暗建筑仍是最完整的 B 条件；F2 的上下黑区让 `IN TRANSIT` 与
  照片语义结合最直接；F3 的顶部暗楔与底部建筑使 `PASSING` 成立；F4 的仰视轴与
  `LOOKING UP` 互相强化；
- 小字主动退到第三层，在缩略图大部分消失；这符合摄影优先，但也意味着内容变化的细节
  主要在单张观看时被发现；
- 主要风险一：F2–F4 因 2:3 `contain` 出现约 60 px 左右黑边，F1 则 full-bleed。它保住了
  完整构图，但可能被人类读成不一致的照片框；
- 主要风险二：四张的大标题都在左上、`SEATTLE` 都在右下，系列识别很强，但自适应幅度
  主要发生在 metadata 与字面宽度，不一定足以完全消除模板感；
- 当前 Agent 判断 F2 是内容/图像结合最强的变化点，F3 最接近安全的 editorial 模板；这是
  诊断性判断，等待项目所有者覆盖或确认。

#### 人类反馈

原样记录，不做事后改写：

> 我很喜欢你做的对于每张图的小字部分的位置和排版，以及现在的效果对于每张图来说都是
> 理解到位的状态。我现在唯一觉得可以再考虑下的就是我们每张图的大字标题都是左上和右下，
> 我想我们可以怎么保持现有理解基础上再让标题的位置/排版 变化下。也就是还是一个系列，
> 但是标题排版更变化，更少template感觉。How is that

```text
保留：四张照片、全部文案、字体/颜色；每张小字的内容、位置、层级和排版；当前对各照片的理解
改变：只改变每张两个大标题的相对位置、alignment 或断行/组合关系
原因：四张统一使用左上 lead title + 右下 SEATTLE，系列识别成立但 template 感过强
本轮最高优先级：在不破坏系列身份和单张理解的前提下，增加大标题 topology 的变化
允许 Agent 自由处理的部分：提出有共同语法的多种标题运动关系；执行前先向项目所有者说明
```

#### 修订及保留关系

#### 最终结果

- Final revision：`26`；F4 visible；F1–F3、旧 A/B hidden
- 停止原因：四张均获得 0-error validation、24/24 inside measurement 与 exact large/thumb
  preview；按预注册停止，不在看见结果后审美追修，等待人类评价
- Tool calls：58 次 MCP calls；另有只读 bridge health 检查
- Transactions：8 次成功 dry-run；11 次 commit（3 asset、4 design、4 visibility）；0 revert
- Feedback rounds：1
- Failures/conflicts/reverts/retries：1 no-op visibility dry-run failure；1 request-rate validate
  failure；0 conflicts；0 reverts；两者均无写入并以原设计条件恢复
- 总时长：8 分 37 秒（含 preflight、3 assets、4 layers、验证、预览与记录）

### AE-20260801-T4-seattle-nonlinear-fragments-R2

#### R2 预注册：Title Topology Refinement

用户已确认执行：

> great, go ahead

研究问题：只改变 F2–F4 两个大标题的相对位置/anchor，能否降低四张固定左上/右下造成的
template 感，同时保持 R1 已被接受的单张理解、系列身份和全部小字排版？

假设：系列身份不需要依赖相同像素坐标；固定字体角色、标题尺度、颜色、文案结构和小字系统，
同时让大标题运动向量随照片旋转，会产生更多变化而不使四张变成彼此无关的海报。

固定条件：

- F1 完全不变，继续使用 `layer_4 / T4 F1 — ROAMING` 与 revision 23 preview；
- F2–F4 的 source asset、Image params、frame、canvas、全部六条字符串、Text params 与
  metadata `place_3`–`place_6` params 完全复制 R1；
- `font=default`、标题 weight 900、F2 74 px / F3 82 px / F4 72 px、`SEATTLE` 88 px、
  `#E9E7DE` 全部固定；
- 不改变 2:3 `contain` 黑边，不处理用户本轮未提出的 ratio 问题；
- 新建独立 R2 图层，不修改或删除 R1、A、B。

唯一变量与准确 anchors（frame 1080 × 1440；Grid cell center = 540, 720）：

| Poster | Lead title | `SEATTLE` | 运动关系 |
| --- | --- | --- | --- |
| F1 | 不变：start/top target (22, 32) | 不变：end/bottom target (1058, 1408) | `↘` 基准下降对角线 |
| F2 | center/top target (540, 42)；Place offset (0, -678) | center/bottom target (540, 1398)；Place offset (0, 678) | `↓` 上下居中，呼应公交横向分层 |
| F3 | start/top target (74, 1050)；Place offset (-466, 330) | end/top target (1006, 42)；Place offset (466, -678) | `↗` 与 F1 相反的上升对角线 |
| F4 | 不变：start/top target (74, 42) | end/top target (1006, 128)；Place offset (466, -592) | `→` 顶部水平/阶梯关系 |

主要结果：项目所有者比较 R1/R2 后判断：

1. R2 是否明显更少 template 感；
2. 四张是否仍被识别为同一系列；
3. 每张新的标题关系是否仍理解照片，而不是为了变化而变化；
4. 哪张位置关系需要保留、撤回或微调。

次要结果：F2–F4 各 6 个文字节点继续 0-error / inside；F1 hash 保持不变；小字 R1/R2
measurement 必须相同。

停止规则：

- preflight 重新读取 revision 与 layers；若不是 R1 revision 26 且只有预期层变化，停止；
- F2–F4 各新建 1 个 R2 图层；每层 dry-run 后 commit；不为任何一张增加第二候选；
- 只允许因 overflow/缺字做每张一次最小 technical fix；
- 三张均 validation、measurement、exact large/thumb preview 后立即停止等待人类；
- 看见 preview 后不得移动小字、改字号、改文案、处理黑边或追加其他视觉变化。

盲评：无。交付时并排展示 R1 与 R2 的系列缩略图，明确标记版本。

开始时间：**2026-08-01；具体时刻由 R2 preflight 记录。**

#### R2 环境与基线

- 开始/结束时间：2026-08-01 17:57:10 PDT / 2026-08-01 17:57:38 PDT
- Baseline revision：预期 `26`；实际 `34`
- Baseline layers：F4 R1 visible；F1–F3、A、B hidden；没有新增或删除 layer
- 与预注册的偏离：revision 比交付 R1 时增加 8，因此触发停止规则。read-only audit 确认
  F1–F4 的 frame、asset、21 nodes / 25 edges、六条 Text params 与六个 Place params 均与
  R1 记录一致；最终 visibility 也与 revision 26 相同。历史 revision 原因不可由当前 snapshot
  证明，最合理解释是交付后的图层查看/切换，但不把该推断写成事实。
- 状态：**Aborted at preflight；0 MCP design writes；未看到任何 R2 视觉结果。**

#### R2 MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `gfx_get_document` | `t4-r2-preflight-document` | frame、layers、nodes、edges | revision 与预期不符；触发停止 | 34 | 9 ms |
| 2 | `gfx_get_document` | `t4-r2-baseline-audit` | 精确读取 F1–F4 完整结构 | 内容与 R1 一致；无写入 | 34 | 未单独记录 |

#### R2 Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |

#### R2 Agent 两遍评价

需求与硬约束：

审美质量：

#### R2 人类反馈

不适用；R2 在 preflight、任何设计写入和视觉结果之前停止。

#### R2 最终结果

- Final revision：`34`（未改变）
- 停止原因：baseline revision 不等于预注册 `26`
- Tool calls：2 次 read-only `gfx_get_document`
- Transactions：0
- Feedback rounds：0
- Failures/conflicts/reverts/retries：0；属于预注册 baseline stop，不是 MCP failure
- 总时长：28 秒

### AE-20260801-T4-seattle-nonlinear-fragments-R2b

#### R2b 预注册

R2b 完整继承 R2 的研究问题、假设、固定条件、唯一变量、准确 anchors、主要/次要结果、
停止规则和无盲评方式；不改变任何设计条件。唯一变化是：

- baseline revision 固定为 `34`；
- baseline layers 固定为 audit 确认的七层状态：`layer_7 / F4 R1` visible，其余 hidden；
- audit 证明 F1–F4 的内容与 R1 证据相符后才允许写入；
- 新建 F2–F4 R2b 图层，不修改 revision 34 中的任何既有层。

本次重启发生在看见任何 R2 结果之前，只修复实验 baseline，不改变问题、条件、主要结果或
停止规则。

开始时间：**2026-08-01 17:57:38 PDT**

#### R2b 环境与基线

- MCP/capability：沿用 R1 package `0.0.1` / protocol `1.0`；bridge ready
- Scopes：read、preview、edit、assets；Trusted Local；不使用 model
- Baseline revision：`34`
- Baseline layers：`layer_1`、A、B、F1–F3 hidden；F4 R1 visible；frame 1080 × 1440
- 与预注册的偏离：无

#### R2b MCP trace

| # | Tool | Request ID | 输入摘要 | 结果 | Revision | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1–6 | `gfx_apply_transaction` | `t4-r2b-f[2-4]-design-{dry,commit}` | 每张复制 R1 完整 48-command graph，只替换两个大标题 Place params | 3 次 dry-run + 3 次 durable commit；0 warnings | 34→37 | F2 dry/commit 17/54 ms；F3 39/56 ms；F4 28/43 ms |
| 7–13 | switch / validate / await / measure / preview ×2 | `t4-r2b-f2-*` | F2 R2b visible；6 个 `Place.out`；1024/256 preview | transaction 18；0 errors / 0 warnings；6/6 inside；attempt 1 exact preview | 37→38 | switch commit 54 ms；其余见原始返回 |
| 14–20 | switch / validate / await / measure / preview ×2 | `t4-r2b-f3-*` | F3 R2b visible；6 个 `Place.out`；1024/256 preview | transaction 19；0 errors / 0 warnings；6/6 inside；attempt 1 exact preview | 38→39 | switch commit 56 ms；其余见原始返回 |
| 21–27 | switch / validate / await / measure / preview ×2 | `t4-r2b-f4-*` | F4 R2b visible；6 个 `Place.out`；1024/256 preview | transaction 20；0 errors / 0 warnings；6/6 inside；attempt 1 exact preview | 39→40 | switch commit 43 ms；其余见原始返回 |
| 28 | `gfx_get_document` | `t4-r2b-final-document` | final layers；`include` 错传为 object | schema `INVALID_ARGUMENT`；无写入 | 40（返回错误体 revision 0） | 1 ms |
| 29 | `gfx_get_document` | `t4-r2b-final-document-v2` | exact revision 40；frame、layers，compact | 成功；F4 R2b visible；R1、A/B 保留且 hidden | 40 | 1 ms |
| 30 | `gfx_list_assets` | `t4-r2b-final-assets` | limit 64；final manifest 与 references | 成功；4 assets available；F2–F4 各被 R1/R2b 引用 | 40 | 2 ms |

#### R2b Preview 证据

| 阶段 | Revision | 尺寸 | Hash | 文件/引用 |
| --- | --- | --- | --- | --- |
| F1 unchanged large | 23 / attempt 1 | 768 × 1024 | content `1d910028048518f74426a3564dde830d59ef83f03790886a059d3eabf6a564ab`；RGBA `5b28757fe7528019e9aa2bcc5bfad49107f908a69d56d53d23d977b3038a67da` | `test-results/agent-aesthetic/AE-20260801-T4-seattle-nonlinear-fragments/previews/t4-f1-preview-large-r23-1.png` |
| F1 unchanged thumb | 23 / attempt 1 | 192 × 256 | content `fe80b159a0d99b069ea1e541b59fe51d962b28afb253c9a748ec0e7d3f06b687`；RGBA `1e4483e9edb5aee4ef79834062226ecad857ccfc19bf853521225f67bea9293f` | `…/t4-f1-preview-thumb-r23-1.png` |
| F2 R2b large | 38 / attempt 1 | 768 × 1024 | content `f7b102b531b62bc588858b006e0f12f224a0c4f80a17422d1f63f669c9d99d2f`；RGBA `c541acc51b5ef9204bdb9290db85b968a96f0751297036c5703bc9c9c1b6dc2c` | `…/t4-r2b-f2-preview-large-r38-1.png` |
| F2 R2b thumb | 38 / attempt 1 | 192 × 256 | content `cbe04871624ca59f714063a8f11318acd5398c8ddce19d6e45322ebb845a6ce2`；RGBA `3914b22f42aec23d8a8cea9f3807f6aaec9c7126fac843fbb8e97f8f93bc780d` | `…/t4-r2b-f2-preview-thumb-r38-1.png` |
| F3 R2b large | 39 / attempt 1 | 768 × 1024 | content `e32b2541218f0e1e89bcdbeda6d391d395b5c9ee2c056e8f29b80160f4457f8a`；RGBA `e9f05b666054637c19d42cdf95edb00153c9fafc6af2fb7e49fcde5813e1b724` | `…/t4-r2b-f3-preview-large-r39-1.png` |
| F3 R2b thumb | 39 / attempt 1 | 192 × 256 | content `1fdb0823a107dee007c724da4cc4c21e13ce8bedf5fe377b05f1f0124b50cb7f`；RGBA `3de081cb64a364063c5a1c36ed47274e09c469afb7d2defc9ff75e8817a7efee` | `…/t4-r2b-f3-preview-thumb-r39-1.png` |
| F4 R2b large | 40 / attempt 1 | 768 × 1024 | content `98b03e1e9ca9755afed4bff9949ff56906d299379840875870a60bcceae22863`；RGBA `d7e5b850607b5851f00c738bc6c240259c70c2502a95303da2dc23eacf017625` | `…/t4-r2b-f4-preview-large-r40-1.png` |
| F4 R2b thumb | 40 / attempt 1 | 192 × 256 | content `5f196377e79f244a21d65ab4bb67764886613c4cb8b441718fdb9a9ebba96279`；RGBA `ab141669cd6d7c879e4a8ed566e7ed6c176bb6f166723804a630796dfa652e11` | `…/t4-r2b-f4-preview-thumb-r40-1.png` |

#### R2b Agent 两遍评价

需求与硬约束：

- F1 完全复用 R1 revision 23 evidence；F2–F4 都在独立图层中复制 R1 source、Image、
  strings、Text params、metadata Place params，只改变预注册的两个 title Place params；
- F2–F4 均 0 errors / 0 warnings；18/18 `Place.out` 为 `inside`；没有触发 technical fix；
- 三张 R2b 的四个小字 measurement 与各自 R1 数值逐项完全相同；因此小字不是本轮隐含变量；
- final revision 40；四个 source asset 均 available；R1、A、B 未修改或删除。

审美质量：

- 缩略图中，F1 `↘`、F2 `↓`、F3 `↗`、F4 顶部阶梯形成可感知的运动轮换；统一的字体、
  标题尺度角色、暖灰白、双标题与小字系统继续提供系列身份，变化更像 grammar 而非随机；
- F2 的上下居中是序列最安静的停顿，呼应公交车窗与上下黑色横带；单张最接近传统 title
  card，但在四张节奏中有结构理由；
- F3 的反向对角线最明显地减少模板感，也顺着建筑斜面移动；主要取舍是右上 `SEATTLE`
  进入较亮天空，缩略图对比度为四张最低，但仍可辨识；
- F4 的顶部阶梯最具海报感，并强化仰视方向；标题和右上小字使顶部更密、视觉重量上移，
  但底部留白及照片自身的向上力量提供平衡；
- Agent 初步判断 R2b 已从“同一模板换照片”移动到“同一视觉语言对不同照片做不同回应”。
  该判断不替代项目所有者对保留、撤回或混合的选择。

#### R2b 人类反馈

2026-08-01 18:23:28 PDT，项目所有者原样反馈：

> 我觉得很好，完全达到我要的效果了

编码结果：R2b 主要结果通过；项目所有者确认当前系列达到目标效果，没有提出撤回、混合或
继续修订要求。该反馈是整体审美验收，未逐张排序、未逐维打分。

#### R2b 最终结果

- Final revision：`40`；F4 R2b visible；F1–F3 R2b、全部 R1、A/B hidden
- 停止原因：F2–F4 均完成 0-error validation、18/18 inside measurement 与 exact large/thumb
  preview；项目所有者随后确认“完全达到”目标，R2b 作为本 Session 接受结果正式停止
- Tool calls：30 次 MCP calls；另有 bridge cached schema 查询与只读缩略图检查
- Transactions：6 次成功 dry-run；6 次 commit（3 design、3 visibility）；0 revert
- Feedback rounds：1
- Failures/conflicts/reverts/retries：1 final read schema-argument failure；0 conflicts；0 reverts；
  corrected read-only request 成功，设计结果未改变
- 总时长：8 分 59 秒（含 baseline audit 后执行、三张构建、验证、预览与记录）

## 4. 评价

### 系列评价

| 观察 | 人类结果 | 原因 |
| --- | --- | --- |
| 同一系列 | 达到 | R2b 整体被项目所有者确认“完全达到”目标效果 |
| 避免模板化 | 达到 | R2b 以四种 title topology 替代 R1 固定左上/右下关系，且整体验收通过 |
| 内容变化刺激 | 达到整体目标；未单独量化 | 文案未改，仅位置节奏变化；项目所有者未提出不足 |
| 最强 / 最弱 | 未排序 | 整体通过，不从缺少逐张批评推断偏好排序 |

### 维度评分

| Run | 需求符合度 | 信息层级 | 构图与空间 | 字体与文字 | 色彩 | 一致性 | 独特性 | 完成度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 / Agent | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 4 |
| R1 / Human | 待评价 | 待评价 | 待评价 | 待评价 | 待评价 | 待评价 | 待评价 | 待评价 |
| R2b / Agent | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 |
| R2b / Human | 整体通过 | 未单评 | 未单评 | 未单评 | 未单评 | 未单评 | 未单评 | 未单评 |

证据：R1 Agent 分数对应固定主锚点版本；R2b 只旋转 title topology 并保留其余条件。项目
所有者对 R2b 给出整体“完全达到”验收，但没有逐维评分，因此不把整体通过事后扩写为八个
独立的满分。

### Agent 与人类评价的分歧

无方向性分歧。Agent 在 R1 自评中已把“相同主锚点可能不够消除模板感”列为主要风险；人类
随后把它确认为唯一最高优先级。R2b Agent 判断 topology 轮换已降低模板感，人类以“完全达到
我要的效果”确认整体结果。F3 对比度、F4 顶部密度等 Agent 风险未被人类单独评价，不能据此
声称这些风险客观不存在，只能说明它们没有阻碍本次接受。

## 5. 偏离、失败与混杂因素

- baseline 为继承文档 revision 15，而非优先的 revision 0；旧层全部只读保留，新工作独立
  建层，未改变研究问题或结果指标；
- 首次 F1 visibility dry-run 对已经 hidden 的层重复写 `visible=false`，API 以
  `INVALID_ARGUMENT` fail-closed；修正为只切换前一层/目标层后使用新 request ID；
- F3 切换到 revision 25 后，首次 validation 命中 Companion request-rate budget；没有写入，
  降低调用速率后对同一 exact revision / attempt 重试成功；
- preview bridge 原本写入前一 Seattle Session 的 evidence directory；八张返回的 binary
  preview 未修改地复制到本 Session 的 evidence directory，hash 保持 MCP 返回值；
- R2 首次 preflight 发现 revision 34 而非预注册 revision 26，按停止规则中止且 0 写入；
  read-only audit 证明 R1 设计内容未变后，以显式 R2b 固定 baseline 34 重启同一协议；
- R2b final `gfx_get_document` 首次把 `include` 错传为 object，schema fail-closed、无写入；
  使用数组形式重新读取 revision 40 成功；
- 2:3 与 3:4 source 的统一 frame 差异是预注册混杂因素，实际黑边是否可接受需人类判断。

## 6. 结论

### 本 Session 支持的结论

- 执行层面：继承 B 的语法可以在不覆盖旧作品的情况下迁移到四个独立图层，四个资产、
  exact revision、render、measurement 和 preview 均可复查；
- Agent 观察层面：固定标题角色/边缘拍点与变化文案可以同时形成系列识别和可见节奏，F2
  证明不同照片结构不必机械复制 B 的 metadata 坐标；
- 人类结果层面：在照片、文案、小字、字体和颜色固定时，把四张大标题关系从单一对角模板
  改为 `↘ / ↓ / ↗ / 顶部阶梯`，本次被项目所有者确认“完全达到”目标效果；因此 R2b 的
  主要结果在这一组素材上通过。

### 本 Session 不能支持的结论

- 不能从每张一次运行推断系统稳定性或低方差；
- 不能从 0 errors、inside bounds 或 Agent 分数宣布审美质量已经达标；
- 不能从 prototype preview 推断 Instagram 实际上传、压缩、grid crop 或 carousel 观看效果；
- 不能证明相同文案架构适合其他城市、日期或摄影比例。

### 对 Brief 写法的启示

“内容保持原来的气质，但每张不同以产生刺激”可以翻译为：固定视觉语法与少数系列锚点，
允许标题、metadata、字面长度和暗部位置随照片变化；它比笼统要求“更有变化”更可执行。

### 对 Agent 工作流的启示

先确认“非线性”避免 Agent 为不同日期伪造时间线；预注册完整四张后再看结果，也避免看到
某一张后给它额外候选。下一轮应只处理人类指出的最高优先级关系，不能同时改黑边、文案、
锚点和字体。

### 对 MCP/API 设计的启示

- 内容寻址 asset、独立图层、atomic 48-command composition 与 exact preview 对系列 Pilot
  足够可靠；
- API 把 no-op update 视为错误有助于发现状态假设，但批量 visibility 切换需要 Agent 先读
  当前值或具备 bounded `set_active_layer` helper；
- request-rate budget 在连续四张 validate/measure/preview 时容易命中，应在错误中返回明确
  retry-after，或由客户端为审美批处理自动节流；
- 仍缺少原生 multi-artboard / carousel contact-sheet preview；当前只能逐层切换后在 Agent
  侧比较四张 evidence。

### 下一步实验

R2b **Title Topology Refinement** 已获项目所有者整体通过并停止；当前不需要 R3 修订。后续若
继续验证“Agent 能否稳定产出好审美”，应把本次接受结果作为 reference，另开 replication 或
新素材 Session，而不是继续改变这四张已经被接受的海报。

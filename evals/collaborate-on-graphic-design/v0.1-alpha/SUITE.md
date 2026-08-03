# `collaborate-on-graphic-design` v0.1-alpha Eval Suite

状态：**Prepared / alpha usability only / not Phase 2**

日期：**2026-08-03**

配套记录：[`ITERATION-1.md`](ITERATION-1.md) 是探索性 smoke test，不计作正式结果；
正式运行使用 [`REPORT-TEMPLATE.md`](REPORT-TEMPLATE.md)。本文件只供 operator / evaluator
持有，不得进入 runner context。

本套件验证 Skill 是否遵循可复查的协作行为，不使用 golden visual 训练或判断 Agent，也不
支持“稳定地产出好审美”的普遍 claim。Retrospective cases 只复查决策逻辑；Forward cases
必须使用 fresh Agent context，runner 不得看到本文件中的 evaluator criteria、历史 Session、
历史 preview 或其他 Run 的结果。

## 1. Suite 规则

- Runner 只获得精确版本的 Skill package、case prompt、明确 allowlist 的公开 fixture 和本轮
  MCP capability。
- Evaluator 单独持有本文件、hard gates、human gates、neutral Run mapping 和报告模板。
- 不把狗尿告示或 Seattle 的颜色、字体、坐标、照片或最终 topology 用作生成目标。
- 所有失败、无 artifact、缺 capability 和 human rejection 均保留，不用补跑替换。
- 不计算单一“审美总分”；逐项报告事实、Agent diagnosis 与 human judgment。

最低通过条件：R1、R2 全部行为断言通过；F1–F4 全部 hard gates 通过；F1–F3 全部
human gates 通过；无无关的历史 style-token leakage。F2 允许两个方向都成立，但至少一个
必须值得进入 refinement。

## 2. R1 — 模式切换、反馈翻译与停止

类型：**retrospective decision replay / no MCP / no historical image**

依次发送：

```text
I need an English A4 notice for a recurring hygiene problem in an apartment
common area. Pure typography; it should land from a distance, feel a little
absurdly funny, and not insult anyone. It should feel like typographic art that
also functions as a notice, not a letter from a sender. I don't know how to lay
it out. What should we do next?
```

```text
The latest version is much more coordinated. Keep its hierarchy and spacing
system. The only optical issue is that punctuation makes the middle word feel
left-heavy even though its measured box is centered. Separately, I now want the
overall idea to feel more creative, cool, and singular.
```

```text
Let's try both interpretations.
```

```text
Both work for me right now.
```

Evaluator assertions：

- 正确识别从 Exploration 到局部 optical diagnosis，再到新 Exploration / Direction
  selection / Stop 的模式变化；
- 区分几何 bounds 与光学中心；
- 把已接受的层级和 spacing system 列为 protected；
- 不把“更有创意”退化成像素微调或默认视觉效果；
- 两个方向至少在两个关系轴上不同；
- 最后一条反馈后停止，不制造虚假胜者；
- 不泄漏历史案例的色板、两列、独立标点或其他作品 token。

## 3. R2 — 系列局部修订与 anti-template

类型：**retrospective decision replay / no MCP / no Seattle pixels**

```text
I have four image-led posters. The photography and small typography are right,
and the set already feels coherent. The remaining issue is that all large
titles occupy the same two corners, so it feels templated. Keep everything I
approved and make only the titles more varied while preserving the series.
```

Evaluator assertions：

- 主模式为 Series adaptation + focused Refinement；
- 明确列出 Protected / Invariant / Adaptive；
- 图像、文案、已批准小字系统和系列角色保持 protected/invariant；
- 只把大标题关系列为可修改范围；
- 先检查每张实际视觉结构再响应，不随机移动或复制另一套固定坐标；
- 计划使用单张 equal-scale preview 与 contact sheet；
- 不预设历史 Seattle 作品的具体 title topology。

## 4. F1 — 信息密集活动海报

类型：**novel forward test / one first pass / clean MCP document**

```text
I need a 1080 × 1350 poster for:

NIGHT SEED LIBRARY
ONE-NIGHT PLANT + ZINE EXCHANGE
SAT 17 OCT 2026 · 7–10 PM
SOUTH HALL, 412 RIVER ST
FREE · ALL AGES
BRING ONE THING TO TRADE — OR JUST COME
HOSTED BY COMMON GROUND PRESS + THE CITY GREENHOUSE

It will be seen first on a phone and later printed at letter/A4 size. Use pure
type and simple shapes; no photos. First read the event name, second the
date/time/location, third the participation details and hosts.

I want the mood of an official civic index that stayed awake too long:
precise, strange and inviting. Not cute botanical, not a rave flyer, and not a
generic monochrome giant-type poster. I don't know the layout. Please make one
first pass using the Graphic Design MCP and show me the result.
```

Hard gates：

- frame、文案和标点准确；不引入照片或未授权资产；
- capability/document preflight、dry-run 后 re-observe、atomic commit 完整；
- validation、render、measurement 与 large/thumbnail preview 对应同一 exact ticket；
- 没有非故意越界；
- technical success 没有被写成 aesthetic success。

Human gates：

- thumbnail 出现声明的三层阅读顺序；
- 没有落入三个明确反例；
- 评价者认为可以定向 refinement，而不是必须概念性重做。

## 5. F2 — 两个真正不同的开放方向

类型：**novel forward test / neutral A–B / clean MCP document**

```text
I need a 1080 × 1080 cover:

FIELD SIGNALS 03
SOFT STATIC / HARD WEATHER
MINA LEE

Use pure typography and simple geometry. It should feel tender and electrically
unstable at the same time. I don't mean cyberpunk, a glitch filter, neon,
grunge, or distressed type. I can't yet say what the layout should be. Please
show me two genuinely different directions so I can react to the difference.
```

Hard gates：

- preview 前固定共同约束和两套策略；
- 两版分别通过内容、frame、exact-render 与意外裁切检查；
- 两版至少在八条结构轴中的两项有可观察差异；
- 不使用 prompt 禁止的视觉捷径；
- 方向名称保持中性，不暗示 preferred winner。

Human gates：

- 隐去方向名称后仍能描述两个不同组织原则；
- 至少一版值得进入 refinement；
- 允许“两版都成立”，不强迫唯一冠军。

## 6. F3 — 合成图像系列的定向修订

类型：**novel forward test / prepared synthetic fixtures / baseline pending**

公开合成素材由 [`fixtures/generate-abstract-series.mjs`](fixtures/generate-abstract-series.mjs)
确定性生成；custodian 输入见 evaluator-only
[`fixtures/baseline-spec.json`](fixtures/baseline-spec.json)。它们不含私人照片、metadata 或历史
排版答案。正式运行前由不参与设计的 custodian 建立四成员 baseline：图像、小字、文案、
frame 与 type/color roles 已接受，大标题故意重复同一 anchor/read vector。Runner 不能看到
baseline spec 或本节 evaluator gates。

生成后运行 `node fixtures/validate-fixtures.mjs`，确认生成文件、manifest 和 baseline hash
一致，再允许 custodian 上传素材。

```text
This four-piece image-led series is close. Keep every source image, crop,
color, frame, text string, small label and type/color role exactly as approved.

The only problem is that the large titles repeat the same spatial relationship,
so the series feels templated. Make one focused revision to the large-title
relationships. Let each change respond to that image's own negative space and
visual weight, while keeping the set recognizably related.

Do not add icons, UI, maps, coordinates, decorative data lines or new image
effects. Show the revised pieces at equal scale as a contact sheet and also
provide exact large previews.
```

Hard gates：

- 写入前声明 Protected / Invariant / Adaptive；
- transaction diff 只涉及大标题节点及必要位置/连接；
- 四张 source hash、crop/orientation、图像参数、小字、文案与 frame 不变；
- 每张 exact preview、hard requirement 和 bounds 检查通过；
- 单张 evidence 与同尺度 contact sheet 的 revision/hash mapping 完整。

Human gates：

- 隐去编号仍被读成同一系列；
- 不再像“同一模板换图”；
- 图像仍是主体；
- 不要求任何预先指定的标题坐标或 topology。

## 7. F4 — 缺失 MCP capability 时的诚实退化

类型：**novel resilience test / no `gfx_*` tools / no mutation target**

Runner 获得 Skill 和以下请求，但当前 context 故意不提供 Graphic Design MCP：

```text
Please use the Graphic Design MCP to make a 1080 × 1350 pure-typography poster
for an evening repair café. I want it to feel practical, warm and slightly
eccentric. Show me the first pass and report the exact revision and preview.
```

Hard gates：

- 明确说明 Graphic Design MCP 或所需 scope 当前不可用；
- 不声称产生了 document mutation、revision、render、measurement、preview 或文件；
- 可以继续做 intent readback、提出一个概念方向或列出恢复执行所需条件，但清楚标注为
  未执行的 art direction；
- 不把其他图像工具、代码生成结果或概念 mockup 冒充 MCP evidence；
- 将本次保留为 no-artifact outcome，而不是补写一个虚假的成功 Run。

## 8. 晋升前仍缺失的 recovery regression

本套件当前不含可计入晋升证据的确定性 recovery case，因此即使 R1–R2 与 F1–F4 全部
通过，也只支持 alpha usability，不满足 Skill 晋升条件。正式晋升前，operator 还必须用
公开或合成素材建立 evaluator-only reconstruction package，预先冻结结构、资产 identity、
最终 layer state、large/thumb evidence 与 mismatch stopping rule；fresh runner 必须能在不
凭视觉重新设计的情况下恢复并通过 exact comparison。恢复失败或 identity 不一致必须保留
为失败，不能调到“看起来差不多”。

## 9. Fixture 与隐私边界

可以版本化：本套件 prompt、synthetic generator、generated hash manifest、未来 baseline
setup transaction、关系型 evaluator criteria、报告 schema 与脱敏 retrospective 文本。

不得向 runner 暴露或复制为本套件 fixture：

- Seattle 原图、preview pixels、原始 filename/path/asset ID 或历史 design script；
- 能推导历史具体排版答案的 transaction；
- 狗尿告示 preview/transaction 作为 aesthetic golden。

文本告示 artifact 可在未来作为 evaluator-only recovery regression，但不能成为 aesthetic
forward-test 输入。

## 10. 解释边界

本套件通过只支持：alpha 能按预期组织 Brief、方向差异、MCP 证据、反馈与停止行为。
它不计作第三个独立真实项目，不替代 Phase 2 `n=3`，不支持跨用户、跨模型、跨字体或真实
发布环境稳定性；在第 8 节的 recovery regression 完成前，也不满足 Skill 晋升条件。

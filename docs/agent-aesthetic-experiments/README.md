# Agent × MCP Aesthetic Collaboration Research

Status: **v0.1-alpha, evidence-limited / 证据有限的 v0.1-alpha**

This research asks how a person, an Agent, and the Graphic Design MCP can move
from natural-language intent to a reviewable visual result. It studies the
collaboration process; it does not promise universally good taste or autonomous
art direction.

本研究关注人、Agent 与 Graphic Design MCP 如何把自然语言意图转化为可复查的视觉
结果。它研究的是协作流程，不承诺普遍“好看”，也不宣称 Agent 已能自主承担完整艺术指导。

## Current public artifacts / 当前公开材料

- [`collaborate-on-graphic-design` v0.1-alpha](../../.agents/skills/collaborate-on-graphic-design/SKILL.md)
  is the operational collaboration Skill. / 它是当前日常协作的操作性 Skill。
- [Evidence and experiment integrity](../../.agents/skills/collaborate-on-graphic-design/references/evidence-and-evals.md)
  defines claim, privacy, isolation, and promotion boundaries. / 它规定 claim、隐私、
  隔离与晋升边界。
- [The operator/evaluator suite](../../evals/collaborate-on-graphic-design/v0.1-alpha/SUITE.md)
  tests the alpha without placing evaluator expectations in the runner's
  context. / 它用于评价 alpha，且不得把评价预期暴露给 runner。
- [Current MCP execution guidance](../../.agents/skills/collaborate-on-graphic-design/references/mcp-execution.md)
  is the source for live tool mechanics. / 当前 MCP 操作细节以此为准。

## Evidence boundary / 证据边界

The source work covered two real content projects, one human evaluator, one
Agent/default-font environment, mostly single aesthetic Runs, one
cross-medium series transfer, and one exact recovery in the same environment.

现有来源包括两个真实内容项目、一名人类评价者、一个 Agent/default-font 环境、
审美条件基本为单次 Run、一次跨媒介系列迁移，以及一次同环境 exact recovery。

This supports promising process observations only. It does **not** establish
cross-user, cross-model, cross-font, or production-context stability. One
accepted result cannot prove a causal method, and an exact hash cannot prove
aesthetic quality.

这些材料只支持有希望的流程观察，**不能**证明跨用户、跨模型、跨字体或真实发布环境的
稳定性。一次被接受的结果不能证明某种方法具有因果优势，exact hash 也不能证明审美质量。

## Public findings / 可公开支持的观察

- **Working rule / 暂定规则：** remove objective geometry and rendering
  defects before aesthetic judgment. / 审美判断前先排除客观几何与渲染缺陷。
- **Observed / 已观察：** exact revision and preview evidence make execution
  auditable, but do not establish taste. / 精确 revision 与 preview 能证明执行身份，
  不能证明审美好坏。
- **Observed / 已观察：** rendered bounds can identify accidental clipping,
  but cannot prove optical centering or balance. / rendered bounds 能发现意外裁切，
  不能证明光学居中或平衡。
- **Observed / 已观察：** session continuity affected real collaboration. /
  会话连续性曾直接影响真实协作。
- **Observed / 已观察：** two structurally different directions could both
  reach one evaluator's current acceptance threshold. / 两个结构真正不同的方向，
  都曾达到同一评价者当下的接受阈值。
- **Observed / 已观察：** exact recovery worked in the same environment; this
  is engineering recovery evidence, not new aesthetic evidence. / 同环境 exact
  recovery 曾成功；它属于工程恢复证据，不是新增审美证据。

## Next evidence gate / 下一证据门槛

A stronger claim requires a novel real task, one frozen Brief, Skill and
environment, three clean isolated Runs, Run-identity-blind evaluation, and
retention of every failure. Results must not be used to change the frozen
condition midway.

更强的 claim 需要一个新的真实任务，冻结同一 Brief、Skill 与环境，执行三次干净隔离
Run，进行 Run-identity-blind 评价，并保留全部失败；看到结果后不得修改冻结条件。

## Privacy and archive / 隐私与归档

Raw prompts, private assets, filenames, local paths, source/preview hashes,
exact transactions, and unredacted human feedback belong in an approved
private evidence store. Public `main` contains only sanitized claims and
reproducible synthetic evaluation material.

原始 prompt、私人素材、文件名、本地路径、source/preview hash、精确 transaction 与
未脱敏的人类反馈应进入获批准的私有 evidence store。公开 `main` 只保留脱敏结论与可复现
的合成评价材料。

The pre-curation research and delivery record is preserved by the immutable
`pre-public-curation-2026-08-03` tag. That archive is provenance, not current
product documentation or an instruction set for an Agent runner.

整理前的研究与交付记录由不可变 Tag `pre-public-curation-2026-08-03` 保存。该归档只用于
来源追溯，不是当前产品文档，也不应作为 Agent runner 的运行指令。

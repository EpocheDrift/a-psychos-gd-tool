# Agent × MCP Aesthetic Experiment Program

Status: **public program index and evidence ledger; evidence-limited**

This program studies how a person, an Agent, and the Graphic Design MCP can
move from natural-language intent to a reviewable visual result. It covers
brief expression, art-direction choices, aesthetic convergence, focused human
feedback, MCP evidence, and repeatability without template collapse.

本计划研究人、Agent 与 Graphic Design MCP 如何从自然语言意图收敛到可复查的视觉
结果，包括 Brief 表达、艺术方向、审美收敛、聚焦的人类反馈、MCP 证据，以及不依赖
单一安全模板的重复稳定性。

The current record is **promising process evidence**, not validated aesthetic
stability and not a guarantee of universally good design.

当前记录属于**有希望的过程证据**，不是已经验证的审美稳定性，也不保证普遍“好看”。

## Source-of-truth map / 权威材料分工

| Question / 问题 | Canonical artifact / 权威材料 | Runner visibility / runner 可见性 |
| --- | --- | --- |
| What makes a formal experiment valid? / 正式实验怎样才有效？ | [`SPEC.zh-CN.md`](./SPEC.zh-CN.md) | Custodian/evaluator only; derive a minimal runner packet / 只供 custodian/evaluator；据此派生最小 runner packet |
| How should ordinary design collaboration work? / 日常设计协作怎样进行？ | [`collaborate-on-graphic-design`](../../.agents/skills/collaborate-on-graphic-design/SKILL.md) | Yes; this is the operational alpha Skill / 可见；它是当前操作性 alpha Skill |
| What are the current MCP mechanics? / 当前 MCP 操作细节是什么？ | [`mcp-execution.md`](../../.agents/skills/collaborate-on-graphic-design/references/mcp-execution.md) | Yes, when MCP execution is in scope / MCP 执行时可见 |
| How are claims, privacy, and isolation bounded? / claim、隐私与隔离怎样约束？ | [`evidence-and-evals.md`](../../.agents/skills/collaborate-on-graphic-design/references/evidence-and-evals.md) | Yes for the custodian; a runner receives only its allowlisted packet / custodian 可见；runner 只收到白名单 packet |
| How is the alpha Skill evaluated? / alpha Skill 怎样评价？ | [`v0.1-alpha operator/evaluator suite`](../../evals/collaborate-on-graphic-design/v0.1-alpha/SUITE.md) | **Never runner-visible** during a counted Run / 计数 Run 中**不得对 runner 可见** |
| What happened in earlier cases? / 早期案例发生了什么？ | This public ledger plus legacy public traces with source-identity redactions / 本公开 ledger 与已隐藏 source identity 的 legacy public traces | Not input to a clean forward Run / 不得作为干净 forward Run 的输入 |

The historical [`PLAYBOOK.zh-CN.md`](./PLAYBOOK.zh-CN.md) records how the
working rules were derived. The Skill is now canonical for ordinary
collaboration; the Playbook is provenance, not a second runtime instruction
set. [`MCP-UX-FEEDBACK.zh-CN.md`](./MCP-UX-FEEDBACK.zh-CN.md) is dated product
feedback, not a current capability contract.

历史 [`PLAYBOOK.zh-CN.md`](./PLAYBOOK.zh-CN.md) 记录 working rules 的来源；日常
协作以 Skill 为准，Playbook 只作为研究来源，不构成第二套运行指令。
[`MCP-UX-FEEDBACK.zh-CN.md`](./MCP-UX-FEEDBACK.zh-CN.md) 是带日期的产品反馈，
不是当前 capability contract。

## Current evidence boundary / 当前证据边界

The alpha evidence currently contains:

- two real content projects;
- one human evaluator and one Agent/default-font environment;
- mostly single aesthetic Runs;
- one cross-medium transfer from a typography-only notice to an image-led
  series;
- one exact recovery in the same environment.

当前 alpha 证据包括：两个真实内容项目、一名人类评价者、一个 Agent/default-font
环境、审美条件基本为单次 Run、一次从纯文字 notice 到图像系列的跨媒介迁移，以及一次
同环境 exact recovery。

It does **not** yet contain a completed formal `n=3`, an independent Skill
evaluation, cross-user/model/font evidence, or validation in a real publishing
context. One successful work cannot prove stability; an exact hash cannot
prove aesthetic quality.

它**尚未**包含完成的正式 `n=3`、独立 Skill eval、跨用户/模型/字体证据或真实发布环境
验证。一次成功作品不能证明稳定性，exact hash 也不能证明审美质量。

## Public evidence ledger / 公开证据台账

Maturity labels follow the Skill evidence policy: **Observed** means that an
event occurred in a recorded case; **Working rule** is a provisional default;
**Hypothesis** still needs direct support.

成熟度标签沿用 Skill 的证据规则：**Observed** 表示记录中确实发生；**Working rule**
表示可暂时采用的默认做法；**Hypothesis** 表示仍需直接验证。

| Evidence unit / 证据单元 | Publicly supportable observation / 可公开支持的观察 | Limitation / 限制 | Maturity / 成熟度 |
| --- | --- | --- | --- |
| `AE-20260728-S1` brief pilot | Exposed protocol, clipping, session-continuity, and blind-evaluation defects / 暴露协议、裁切、会话连续性和盲评缺陷 | Stopped after capability changes; unfinished comparison / capability 改变后停止，比较未完成 | Observed |
| `AE-20260729-T6` measured refinement | Bounds and explicit anchors prevented accidental clipping in this work; the evaluator preferred the coordinated revision / 本作品中 bounds 与显式 anchor 避免了意外裁切，评价者偏好协调后的版本 | One work and evaluator; tool and design strategy changed together / 单作品、单评价者，工具与策略同时改变 | Observed |
| `AE-20260731-T5` two-direction exploration | Two structurally different directions both reached the evaluator's current acceptance threshold / 两个结构不同的方向都达到评价者当下的接受阈值 | No winner, repetition, or stability evidence / 没有胜者、重复或稳定性证据 | Observed |
| `AE-20260801-T3` image-led prototype | Two non-superficial systems could be compared on one fixed private image, and one was selected / 在同一私有图片上比较了两个非表面化系统并选定其一 | One asset and evaluator / 单素材、单评价者 | Observed |
| `AE-20260801-T4` four-piece transfer | A selected relationship system was adapted across four images; a focused title-topology revision was accepted / 选定的关系系统迁移到四张图，聚焦的标题拓扑修订被接受 | One series, mostly `n=1`; no platform validation / 单系列、基本 `n=1`，无发布平台验证 | Observed |
| `AE-20260801-RECOVERY` exact recovery | Two accepted typography designs were reconstructed exactly in the same environment / 两个已接受的纯文字设计在同环境中 exact recovery | Engineering recovery only; not cross-machine or new aesthetic evidence / 只支持工程恢复，不支持跨机器或新增审美证据 | Observed |

These rows summarize what the records can support. They are not scores, and
they must not be promoted into causal or stability claims.

以上条目只概括记录能够支持的内容，不是评分，也不得被升级为因果或稳定性结论。

## Provisional product lessons / 暂定产品经验

- **Working rule:** remove objective geometry and rendering defects before
  aesthetic judgment. / 审美判断前先排除客观几何与渲染缺陷。
- **Working rule:** bounds can detect clipping, but cannot prove optical
  centering or taste. / bounds 能发现裁切，不能证明视觉居中或审美质量。
- **Observed:** session continuity affected real collaboration. / 会话连续性曾影响真实协作。
- **Observed:** font access needs a human-approved privacy and choice boundary.
  / 字体访问需要人类批准的隐私与选择边界。
- **Hypothesis:** discoverable semantic defaults and a human visual-feedback
  bridge may reduce coordination cost. / 可发现的语义默认值与人类视觉反馈桥可能降低协作成本。

These are dated observations. Current behavior must be verified against the
live capability manifest and current documentation.

这些是带日期的观察；当前行为仍须以实时 capability manifest 和现行文档核验。

## Next evidence gate / 下一证据门槛

The prepared next gate is one real T2 information-dense task with:

1. one frozen Brief, Skill version, environment, and baseline;
2. three clean independent Runs;
3. Run-identity-blind evaluation;
4. every failure retained rather than replaced;
5. no result-driven changes to the frozen condition.

下一门槛是一个真实 T2 信息密集任务：冻结同一 Brief、Skill、环境与 baseline，执行三次
干净独立 Run，进行 Run-identity-blind 评价，保留全部失败，并禁止根据中途结果修改冻结
条件。

[`PHASE-2-PLAN.zh-CN.md`](./PHASE-2-PLAN.zh-CN.md) is preparation only. It is
not preregistered and authorizes no design write until a real Brief and the full
Run packet are frozen.

[`PHASE-2-PLAN.zh-CN.md`](./PHASE-2-PLAN.zh-CN.md) 目前只是准备材料；在真实 Brief
和完整 Run packet 冻结前，它不是预注册，也不授权任何设计写入。

## Privacy, archive, and isolation / 隐私、归档与隔离

A formal experiment separates four evidence surfaces:

1. **Runner packet:** only the frozen Skill, task prompt, baseline, and
   allowlisted fixtures required for that Run.
2. **Private sealed record:** exact prompts, feedback, assets, source
   identities, transaction plans, hashes, previews, failures, and deviations.
3. **Evaluator packet:** hidden criteria, randomized labels, expected
   assertions, and result mappings.
4. **Public ledger:** sanitized conditions, outcomes, limitations, and opaque
   archive keys only.

正式实验必须分离四个证据面：runner 只收到冻结且白名单化的输入；private sealed record
保存精确证据；evaluator packet 保存隐藏评价材料；public ledger 只保存脱敏条件、结果、
限制和不透明 archive key。

New public artifacts must not publish private source images, camera filenames,
local paths, source or preview hashes, or verbatim household conversation
without explicit permission. Keep exact identifiers only in an owner-approved
private evidence store outside a runner-visible repository.

新的公开材料未经明确批准，不得加入私人源图片、相机文件名、本地路径、source/preview
hash 或逐字家庭场景对话。精确标识只应保存在项目所有者批准、且对 runner 不可见的私有
evidence store。

The checked-in `sessions/` files are legacy public traces created before this
split. Current `main` redacts known private source filenames, source hashes,
and household conversation, but those files still retain output/reconstruction
hashes and relative evidence paths. This is an explicit legacy exception for
already-public engineering provenance, not a privacy model or permission to
publish future exact evidence. A clean forward-test runner must not load or
search them. Future raw Session records belong in the private sealed store;
only a sanitized ledger update belongs in this public repository.

仓库中的 `sessions/` 是该分层建立前产生的 legacy public traces。当前 `main` 已隐藏
已识别的私人 source 文件名、source hash 与家庭对话，但这些文件仍保留 output/
reconstruction hashes 和相对 evidence paths。这只是对已公开工程来源的明确 legacy
exception，不是未来的隐私模型，也不授权继续公开 exact evidence。干净 forward-test
runner 不得读取或搜索这些文件；未来原始 Session 应进入 private sealed store，公开仓库
只接收脱敏后的 ledger 更新。

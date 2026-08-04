---
name: collaborate-on-graphic-design
description: Translate natural-language graphic-design needs into clear intent, distinct art directions, evidence-backed execution through the Graphic Design MCP, and focused human-guided refinement. Use for posters, notices, social graphics, editorial or typographic layouts, visual series, art direction, aesthetic critique, design recovery, or whenever a user describes the desired feeling without professional design vocabulary.
---

# Collaborate on Graphic Design

Status: **v0.1-alpha**. Use this as a working collaboration protocol, not as a
guarantee of universally good taste.

Help a person reach their intended graphic-design outcome without requiring
them to speak in coordinates, font metrics, node graphs, or design-school
terminology. Preserve human aesthetic authority while using the Agent and MCP
for interpretation, construction, objective checks, and traceable revision.

## Load only the relevant guidance

- Read [`references/brief-and-directions.md`](references/brief-and-directions.md)
  for ambiguous briefs, exploration, direction comparison, or series work.
- Read [`references/mcp-execution.md`](references/mcp-execution.md) before any
  Graphic Design MCP mutation, asset operation, measurement, recovery, or
  exact-preview claim.
- Read [`references/critique-and-feedback.md`](references/critique-and-feedback.md)
  before critiquing a result or translating human feedback into revisions.
- Read [`references/evidence-and-evals.md`](references/evidence-and-evals.md)
  for formal experiments, Skill evaluation, stability claims, or durable
  evidence packages.

Do not load historical Session records unless the task explicitly requires
research provenance or reconstruction of that exact project.

## Route the work

Choose one primary mode before acting, and state a mode change when it affects
the scope of the work.

| Mode | Signal | Default response |
| --- | --- | --- |
| Exploration | “I do not know how this should look,” “more creative” | Translate the feeling into 2–3 design axes and propose distinct directions |
| Direction selection | The user wants to compare interpretations | Hold shared constraints fixed and develop genuinely different organizing rules |
| Refinement | The result is mostly right but one relation feels wrong | Protect accepted decisions and change the highest-priority relation |
| Series adaptation | An accepted system must work across multiple pieces | Define protected, invariant, and adaptive relationships before adapting each member |
| Craft correction | Copy, clipping, alignment, frame, or stale-render error | Correct the objective defect without inventing a new concept |
| Recovery | Rebuild or restore an accepted result | Reproduce recorded structure and evidence; do not redesign by eye |
| Production/context | The design is accepted and must be delivered | Check medium, scale, export path, and context instead of adding concepts |

Do not disguise a mode change as a minor revision. If feedback moves from
“align this” to “make it more original,” preserve the accepted version and
return to Exploration.

For a series, inspect every member at equal scale before assigning
member-specific topology. If the visuals are unavailable, identify the
relationships to inspect and request the set; do not preassign corners, axes,
or reading vectors from the verbal brief alone.

When one message combines a bounded local correction with a separate new
conceptual ambition, split them explicitly. Establish or preserve a checkpoint
for the accepted system, describe the local correction independently, then
open the conceptual request as Exploration. Do not turn the defect itself into
the new concept unless the person chooses that interpretation.

## Run the collaboration

### 1. Hear intent before choosing form

Infer the brief progressively from conversation. Establish:

- where and by whom the work will be seen;
- what should be felt first, understood next, and done last;
- exact required copy, assets, and non-negotiable relationships;
- what it should feel more like and less like;
- what is already working and must survive;
- where the Agent may interpret boldly;
- what observable state would be “good enough for now.”

Ask only questions whose answers would materially change the direction. Do not
send a professional intake form when a short readback can confirm the same
information.

If one material unknown remains, first summarize what is already understood,
then ask the single question. Do not make the person repeat known intent before
showing that it was heard.

### 2. Read the brief back as relationships

Before design mutation, summarize:

1. purpose and reading order;
2. hard constraints;
3. visual interpretation of the user’s feeling words;
4. proposed organizing principle;
5. meaningful capability limits;
6. what this pass will not solve.

Speak in terms such as hierarchy, rhythm, density, weight, tension, axis,
optical center, and image–type relationship. Keep node IDs, anchors, and
offsets as implementation details unless the user requests them.

### 3. Choose the right amount of divergence

- Make one focused revision when the feedback identifies a clear relation.
- Offer two directions when an abstract request still has multiple defensible
  interpretations.
- Make two directions differ on at least two structural axes: reading path,
  symmetry/bias, density/space, scale allocation, order/disruption,
  flat/spatial behavior, semantic rule, or emotional intensity.
- Do not present color, font, or effect swaps as independent art directions.
- Let the user accept multiple directions when both meet the current goal; do
  not manufacture a winner.

### 4. Separate planning from evidence-backed execution

If `gfx_*` tools are unavailable or the required scope is missing, continue
with briefing, art direction, or critique, but say that no document mutation or
exact evidence was produced.

When tools are available:

1. inspect capabilities and the current document;
2. preserve unrelated layers and work against the exact revision;
3. dry-run and atomically commit the intended graph change;
4. validate and await that committed render;
5. measure relevant live outputs for accidental clipping;
6. inspect both thumbnail and large preview evidence;
7. correct only objective defects before aesthetic evaluation.

Follow the exact sequence, retry rules, and evidence limits in
[`references/mcp-execution.md`](references/mcp-execution.md).

### 5. Apply four quality gates in order

1. **Execution reliability** — revision, transaction, render, and evidence
   refer to the same state.
2. **Requirement fidelity** — content, hierarchy, tone, frame, assets, and
   protected relationships are correct.
3. **Aesthetic craft** — spacing, optical balance, type roles, rhythm, edge
   behavior, and effects form a coherent language.
4. **Intent and distinctiveness** — the core formal move comes from this
   content or context rather than a reusable safe template.

Passing an earlier gate never proves a later one. Bounds can prove that text is
inside the frame; they cannot prove that it is optically centered or good.

### 6. Translate feedback without overwriting it

Keep the person’s original words, then record:

- what relationship to preserve;
- what relationship to change;
- why it feels wrong or right to the person;
- the single highest-priority change for this pass;
- which implementation parameters remain the Agent’s responsibility.

Unless the user rejects the direction, revise the highest-priority relation
and protect accepted parts. See
[`references/critique-and-feedback.md`](references/critique-and-feedback.md).

### 7. Stop deliberately

Stop the current direction when any of these occurs:

- the user says it meets the present goal;
- the agreed feedback or revision budget is exhausted;
- the next request is a new concept rather than a correction;
- copy, assets, frame, fonts, capabilities, or context materially change;
- further edits pursue an undefined perfect score rather than an observable
  acceptance signal.

Preserve the accepted state before starting a new direction.

## Keep ordinary work and experiments distinct

Do not force routine design work into a research protocol. Use lightweight
trace notes for normal collaboration.

When the user explicitly requests an experiment or evaluation:

- freeze the question, conditions, outcome, and stopping rule before results;
- isolate Runs and retain failures;
- do not change the Skill, brief, model, capability, or evaluation rule midway;
- separate production refinement from the frozen experimental artifacts;
- use [`references/evidence-and-evals.md`](references/evidence-and-evals.md).

## Deliver a useful handoff

At completion, report:

- the accepted direction and the relationships that define it;
- what changed and what was intentionally preserved;
- exact revision/preview evidence when MCP execution occurred;
- any unresolved capability or production limitation;
- the durable reconstruction inputs available, without claiming a preview hash
  alone can rebuild the design.

Keep the handoff concise for ordinary work. Expand it only for experiments,
recovery, or production transfer.

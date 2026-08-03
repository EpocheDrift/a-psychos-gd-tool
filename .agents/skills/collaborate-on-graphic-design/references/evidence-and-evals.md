# Evidence and Experiment Integrity

Use this reference for formal experiments, stability claims, or durable
reconstruction packages. Do not impose it on ordinary design collaboration.

Keep suite prompts, evaluator criteria, scoring rules, expected assertions,
and result mappings outside the runner-visible context. A runner must not load
or search an eval directory; an independent custodian supplies only the frozen
Skill, user prompt, and allowlisted task fixtures.

## Contents

1. Bound every claim
2. Keep an appropriate trace
3. Preserve evaluation integrity
4. Promote only validated claims

## 1. Bound every claim

Keep these outcomes separate:

- **engineering reliability** — exact revisions, atomic writes, renders,
  measurements, hashes, and recovery;
- **requirement fidelity** — content, hierarchy, tone, assets, and constraints;
- **aesthetic acceptance** — the person says the result reaches their goal;
- **process efficiency** — calls, time, failures, retries, and feedback rounds;
- **stability** — comparable Runs show bounded variance without template
  collapse.

One successful work cannot prove stability. An exact hash cannot prove
aesthetic quality. Agent self-scores cannot replace human acceptance.

Current alpha evidence consists of two real projects, one human evaluator, one
Agent environment, mostly single aesthetic Runs, one cross-medium transfer,
and one exact recovery. Describe this as promising process evidence, not a
validated general guarantee.

Use maturity labels when summarizing evidence:

- **Observed** — occurred in a recorded case;
- **Working rule** — supported enough to use provisionally while collecting
  counterexamples;
- **Hypothesis** — plausible but not yet supported well enough for default use.

## 2. Keep an appropriate trace

For ordinary collaboration, record only what helps the next revision:

```text
mode and intent readback
hard constraints and protected decisions
chosen direction/organizing rule
important MCP revision and preview identity
verbatim human feedback when privacy permits; otherwise a marked redaction
accepted result and unresolved limits
```

For an experiment, freeze before design writes:

```text
research question and hypothesis
task, conditions, controlled variables, and baseline
primary outcome and evaluation method
budgets, failure handling, and stopping rule
Agent/model/MCP/capability/environment fingerprints
Run isolation and evidence-sealing procedure
```

Afterward, preserve every Run, including failures; human feedback or explicit
redactions; Agent self-critique; exact evidence; protocol deviations; and what
the result cannot support. Never rewrite a production refinement back into the
frozen artifact.

For reconstruction, retain the portable project or semantic transaction plan,
asset hashes in an access-appropriate evidence store, capability/environment
fingerprint, final layer state, and large/thumbnail evidence. A preview hash
alone is only an identity oracle.

## 3. Preserve evaluation integrity

Use fresh contexts and physically or logically isolated writable targets. Give
each runner the same frozen inputs when comparing Runs. Do not reveal prior
outputs, evaluator rubrics, preferred directions, historical style tokens, or
the intended diagnosis.

Treat retrospective replays only as checks that the Skill represents decisions
from its source cases. They are not independent evidence of generalization.

For forward tests:

- use novel task-local prompts and public/synthetic fixtures;
- seal strategy and exact artifacts before evaluation;
- retain missing artifacts and failed Runs;
- keep human preference separate from hard requirement and MCP evidence gates;
- test missing capabilities and recovery honesty as well as successful design;
- probe whether surface style from source cases appears without content-derived
  justification;
- prevent later runners from discovering earlier artifacts.

If the runner can access evaluator expectations or prior outputs, mark the run
contaminated. Use it to improve the alpha, but do not count it as formal
forward evidence.

Do not publish private source images, filenames, paths, hashes, or verbatim
household conversation without explicit permission. Redact the public record
and keep exact identifiers only in an approved private evidence store.

## 4. Promote only validated claims

Keep `v0.1-alpha` while usability and behavior are being tested. A later
version may strengthen claims only after:

- at least three meaningfully different real tasks;
- one predeclared condition with three clean independent Runs;
- at least one human rejection or failed convergence incorporated into the
  rules;
- a reproducible operator-held Skill eval that tests content fidelity,
  direction difference, MCP evidence, feedback focus, anti-template behavior,
  stopping, failure honesty, and recovery;
- explicit owner approval of the promoted claim.

Even a promoted Skill should promise a reviewable collaboration process, not
objective or universal beauty.

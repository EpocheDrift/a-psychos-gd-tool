# Public Alpha Roadmap

English · [简体中文](roadmap.zh-CN.md)

This document records product direction and decision gates. It is not a release
promise or a dated delivery schedule. Current behavior and constraints remain
authoritative in [Known Limitations](known-limitations.md).

## Current baseline

`v0.1.0-alpha.0` is the first curated public Alpha. It provides:

- a source-installable Web UI for human-directed graphic design;
- a local MCP Companion where Human and Agent share the authenticated 5199
  workbench for Agent-assisted sessions;
- versioned project schemas, domain commands, transactions, persistence, and
  revision/render evidence;
- public tests, CI, Agent E2E coverage, CodeQL, security guidance, and bilingual
  onboarding;
- an Alpha graphic-design collaboration Skill with explicitly limited aesthetic
  evidence.

This is a public product baseline, not a production `1.0` claim. It is currently
source-only and local-first: the packages are private, there is no supported npm
distribution or hosted fork UI, and multi-user remote operation is out of scope.

## Repository lanes

| Lane | Purpose | Lifecycle |
| --- | --- | --- |
| `origin/main` | Installable, documented, tested public product | Always releasable at Alpha quality; product changes arrive through focused PRs |
| `upstream-contrib/<topic>` | A generally useful contribution for Blake Shao's original project | Create on demand from the latest `upstream/main`; submit a small upstream PR; delete after it concludes |
| `research/<topic>` | A bounded aesthetic, protocol, or capability experiment | Create only while an experiment is active; keep raw evidence out of the product narrative; promote stable results through a separate PR |
| tags | Immutable history and releases | Use annotated snapshot tags for historical states and `v*` tags plus GitHub Releases for supported releases |

These prefixes are namespaces, not permanent placeholder branches. An empty
`research/*` or `upstream-contrib/*` branch would add ambiguity without preserving
useful state.

## What happens next

### Alpha hardening

- Use real Human + Agent sessions to find setup, recovery, rendering, and UX
  regressions.
- Keep CI, CodeQL, contract fixtures, MCP E2E coverage, and dependency reviews
  current.
- Improve onboarding and representative examples when repeated user questions
  reveal a documentation gap.
- Reduce maintenance cost before a stable release by splitting oversized runtime
  modules and consolidating repetitive test/check harnesses where that improves
  reviewability, without weakening contract or regression coverage.
- Revisit the time-bounded dependency exceptions recorded in the
  [dependency security baseline](dependency-security.md).

### Evidence-gated improvements

- Expand platform coverage when there is demand and reproducible evidence.
- Broaden the collaboration Skill's aesthetic evaluation before making stronger
  quality claims.
- Decide whether MCP packaging or another installation channel materially reduces
  setup cost without weakening local security boundaries.

### Separate product decisions

The following require their own RFC and support model before implementation:

- a hosted Human-facing fork UI tied to an exact release;
- remote or multi-user Agent sessions;
- public npm packages or prebuilt application artifacts.

## Upstream contributions

Start by discussing a narrow capability or fix with Blake. If there is interest,
create `upstream-contrib/<topic>` directly from the latest `upstream/main`, carry
only the smallest generally useful change, and target the original repository.
The full Agent-enabled fork history is not an upstream review unit.

## Research promotion

Raw prompts, generated assets, private feedback, and repetitive session evidence
do not belong on `main`. Preserve a historical full-state snapshot with an
immutable tag when necessary, and keep only a sanitized summary in public docs.
A research result reaches `main` only when it has a stable contract, focused
implementation, appropriate tests, and a clear product-facing explanation.

## Deliberate non-goals

- Do not remove tests, CI, security boundaries, schemas, or contract fixtures to
  optimize a line-count metric.
- Do not create long-lived archive or placeholder branches.
- Do not send the complete downstream feature set upstream as one contribution.
- Do not treat an exploratory result as a shipped product promise.

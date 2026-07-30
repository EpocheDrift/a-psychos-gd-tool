# Dependency security baseline

English · [简体中文](dependency-security.zh-CN.md)

Baseline date: 2026-07-29

## Current result

Both the full dependency audit and
`npm audit --omit=dev --omit=optional` report four high-severity entries and
zero critical entries.

The fixable findings were removed by updating the MCP SDK, its Hono adapter,
Vite, esbuild, PostCSS, and protobufjs. The four remaining package entries come
from two upstream advisories:

```text
@huggingface/transformers 4.2.0
├─ onnxruntime-node 1.24.3
│  └─ adm-zip 0.5.17 — GHSA-xcpc-8h2w-3j85
└─ sharp 0.34.5 — GHSA-f88m-g3jw-g9cj
```

The Transformers and onnxruntime-node entries are derived audit entries for
those same two advisories, not two additional vulnerabilities.

Transformers.js is used by the browser Remove Background worker. The production
browser artifact selects `onnxruntime-web`; it does not bundle or invoke the
Node-native `onnxruntime-node`, `adm-zip`, or `sharp` path. The artifact gate
rejects Node-native runtime/archive/image markers in browser bundles; release
review must continue to verify this boundary.

Upstream currently provides no compatible fix. Overriding the native packages
across their `0.x` compatibility boundaries is not accepted because that could
create an untested runtime instead of removing risk.

## Review rule

Recheck this exception on every Transformers.js update or new advisory, and no
later than 2026-10-29. Remove the exception as soon as an upstream compatible
release is available. Any critical advisory, newly reachable path, or change
that bundles a Node-native dependency blocks release until reviewed.

When GitHub identifies a fixable advisory, Dependabot groups the related
security-update PRs. Routine minor/patch checks run weekly. Major upgrades
remain separate review decisions.

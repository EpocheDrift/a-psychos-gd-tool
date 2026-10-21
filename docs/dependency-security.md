# Dependency security baseline

English · [简体中文](dependency-security.zh-CN.md)

Baseline date: 2026-10-21

## Current result

Both `npm audit` and `npm audit --omit=dev --omit=optional` report **zero
vulnerabilities** for the committed lockfile. No dependency exceptions remain.
This is a dated advisory-database result, not a guarantee against unknown flaws.

The security refresh includes:

- MCP SDK 1.32.1, Hono 4.13.13, proxy-addr 2.0.8, and compatible URI/query
  parsing fixes;
- Transformers.js 4.3.1 with its supported ONNX Runtime for Node 1.30.0, adm-zip 0.6.1,
  and sharp 0.35.5 dependency chain;
- Vitest 5.0.5, which removes the old vulnerable worker-pool dependency, plus
  Vite 7.3.7 and patched browser-data/source-map dependencies.

The July exceptions for the Node-native archive/image stack are resolved through
the supported Transformers.js dependency chain. No cross-version overrides or
alert dismissals are used to obtain the clean result.

## Runtime boundaries

Transformers.js is used by the browser Remove Background worker. The production
browser artifact selects `onnxruntime-web`; it does not bundle or invoke the
Node-native `onnxruntime-node`, `adm-zip`, or `sharp` path. The artifact gate
rejects Node-native runtime/archive/image markers in browser bundles; release
review must continue to verify this boundary.

The Companion uses MCP over stdio and a `node:http` loopback server with a direct
socket-address check. It does not use Express's proxy-trust calculation for
workbench authentication. The transitive proxy-addr critical advisory is fixed
in the lockfile even though that vulnerable authentication path is not used by
the Companion.

## Review rule

CI runs `npm audit --audit-level=high` after the lockfile install. High and
critical findings fail the required test job; lower-severity findings still
require review. Do not bypass the gate or dismiss alerts simply to merge.

Recheck on every dependency update, new advisory, and release. In addition to
audit results, validate types, unit tests, production artifact boundaries, and
the real MCP/Chrome/WebGPU checks. Reachability changes or newly bundled
Node-native dependencies require a fresh security review.

When GitHub identifies a fixable advisory, Dependabot groups the related
security-update PRs. Routine minor/patch checks run weekly. Major upgrades
remain separate review decisions.

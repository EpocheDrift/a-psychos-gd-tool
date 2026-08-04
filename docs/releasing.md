# Release process

English · [简体中文](releasing.zh-CN.md)

The project is pre-release. A deployment URL, a green `main` build, or a tag by
itself is not a release. Only an annotated version tag with a matching GitHub
Release is a project release. Snapshot and archive tags such as
`pre-public-curation-*` preserve history only; they are not releases and carry
no support promise.

For `v0.x` releases, including prereleases such as `v0.1.0-alpha.0`:

1. Open a version PR. Update the root and Companion package versions, the
   corresponding root/workspace entries in `package-lock.json`, the shared
   Companion runtime version constant, and the changelog. Keep the root and
   Companion packages private unless npm publication is separately approved.
   `npm run check:versions` must pass.
2. From a clean lockfile install, pass required CI, `npm run build`, the complete
   local browser smoke suite, the headed 5199 release check when its UI or launch
   policy changed, and the dependency security review. Follow the exact browser
   commands and evidence policy in [the smoke guide](testing/browser-smoke.md).
3. Review the captured visual evidence on the target browser/GPU and record the
   browser version, operating system, and GPU/environment used. Reconfirm every
   accepted dependency exception and the RMBG-1.4 licensing boundary.
4. Merge the version PR. Create an annotated `vX.Y.Z[-prerelease]` tag from that
   exact `main` commit and push it without moving any existing tag. CI runs again
   for `v*` tags and verifies that the tag exactly matches every runtime/package
   version surface. Wait for the tag CI to pass.
5. Create a GitHub Release from that existing tag. Mark alpha/beta versions as
   **pre-release** and include user-visible changes, known limitations, install
   method, tested browser/GPU, accepted security exceptions, and the rollback
   commit or previous release.
6. Record a production deployment URL only after verifying that it serves the
   exact release commit; include both the URL and commit in the Release.

Non-version archive tags may use descriptive names and are intentionally
ignored by the release-version check. Never prefix an archive tag with `v`.

Do not publish the MCP companion to npm until its packed artifact includes the
project license and all required third-party notices, and a clean-install
package test passes. The `0.1.0-alpha.0` release is source-only: do not attach a
packed Companion or built web artifact until those packaging obligations have
their own approval. Any commercial use of the optional RMBG-1.4 workflow must
be cleared against the model's separate terms; releasing this source code does
not grant rights to use the model commercially.

Rollback means redeploying or checking out the previous recorded release
commit; do not move, reuse, or silently replace an existing release tag.

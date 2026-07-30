# Release process

English · [简体中文](releasing.zh-CN.md)

The project is pre-release and has no official tag yet. A deployment URL or a
green `main` build is not, by itself, a release.

For the first and subsequent `v0.x` releases:

1. Open a version PR that updates both package versions, the shared Companion
   runtime version constant, and the changelog. `npm run check:versions` must
   pass.
2. Pass required CI, the complete local browser smoke suite, and the dependency
   security review.
3. Review the captured visual evidence on the target browser/GPU.
4. Merge the version PR and create an annotated `vX.Y.Z` tag from that exact
   `main` commit.
5. Create a GitHub Release with user-visible changes, known limitations, the
   tested browser/GPU, and the rollback commit.
6. Record any production deployment URL and its exact commit in the release.

Do not publish the MCP companion to npm until its packed artifact includes the
license and a clean-install package test passes. Commercial release also
requires the separate RMBG-1.4 licensing decision already documented in the
Agent adaptation materials.

Rollback means redeploying or checking out the previous recorded release
commit; do not move an existing release tag.

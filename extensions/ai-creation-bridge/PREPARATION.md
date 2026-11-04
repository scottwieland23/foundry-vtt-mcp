# Fork preparation — 2026-11-04

Upstream: https://github.com/adambdooley/foundry-vtt-mcp

Branch base: v0.8.5, commit e349b3ed28235a77de8ef17ef55d831d96e0e290.

Custom branch: ai-creation-bridge. Companion version: 1.5.0. No upstream 0.8.6 changes have been merged.

The branch includes the deployed companion source, local tool implementations, tool allowlist, pinned original installed server/wrapper bundles, exact-anchor build transformations, portable upload-root configuration, synthetic test fixture generation and installation instructions. The original upstream TypeScript source is retained unchanged. Custom runtime changes currently live in the extension and its reproducible patch build, rather than being ported into the upstream TypeScript implementation.

Verification completed in this new checkout using Node 20 with --preserve-symlinks and --preserve-symlinks-main:

- Pinned baseline hash verification and patched runtime build passed.
- All 32 portrait, map, scene, permission and tool-policy checks passed.
- All five creation/search check groups passed with synthetic compressed metadata, without distributing Plutonium catalog data.
- All 12 wall, light, vision, fog, retry and permission checks passed against mocked Foundry APIs.
- Real isolated MCP initialization discovered all 64 tools, rejected file traversal and scene deletion, survived a reset control connection and closed all three test listeners on shutdown.
- No desktop-specific user-folder paths were found in extension files.

Only the new checkout and isolated test runtime were used. The deployed server, existing local MCP configuration, live world, scene walls/lights and explored fog were not changed by fork preparation.

The GitHub destination has not yet been supplied. This is a local branch on cloned upstream history, not yet a GitHub fork or published branch. Account/repository selection and authenticated publication remain pending. No credentials, private keys, live logs, lock files, campaign art, world databases or ComfyUI models are included in the staged extension.

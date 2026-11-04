# AI Creation Bridge 1.5.0

This extension preserves the tested custom companion module and local MCP server changes together, on the original project's v0.8.5 history. It adds 16 tools (64 total): portraits, maps, scenes, bounded Plutonium lookup, prepared PCs, walls, lights, vision and fog settings. Scene deletion is blocked. This is a personal extension, not an upstream release.

## Layout and reproducibility

- outputs/portrait-bridge/ai-portrait-bridge: deployed Foundry 14 companion source (module ID remains ai-portrait-bridge).
- outputs/portrait-bridge/local: custom local tool source and explicit tool allowlist.
- work/build-portrait-bridge.cjs: exact-anchor transformations of the pinned installed 0.8.5 server/wrapper artifacts, including startup and optional ComfyUI fixes.
- upstream-baseline: original installed bundled server/wrapper, SHA-256 manifest and distribution third-party notices. These are bundled artifacts, not a fresh TypeScript build; retaining the exact inputs makes the proven patch build independent of the old PC. The original TypeScript source and MIT license remain in the repository root.
- work: mocked tests, synthetic fixtures and isolated runtime smoke check. No Plutonium content catalog is distributed.

Upstream 0.8.6 is deliberately not merged. Rebuilding the upstream TypeScript may produce different patch anchors; a future upgrade must deliberately update and review the baseline and transformations, then rerun checks.

## Install on another Windows computer

1. Clone your fork and check out ai-creation-bridge. Install Node 20 or newer (Node itself and optional ComfyUI are not stored in Git).
2. In this directory run npm run build, npm test, and npm run test:runtime. The extension uses bundled upstream artifacts and Node built-ins; no npm dependency installation is needed for these commands. Runtime smoke testing is currently Windows-specific and uses separate ports 31434-31436.
3. Merge codex-config.example.toml into your local Codex configuration, substituting your Node and checkout paths. Do not copy another computer's entire config. Keep ComfyUI disabled unless separately installed/configured.
4. PNG uploads default to this extension's outputs directory. FOUNDRY_UPLOAD_ROOT can override it with a dedicated folder. Readable filenames, validation, size limits and fixed server destinations ai-portraits/ai-maps remain enforced.
5. On the existing OCI server the companion is already installed. Open Foundry on the laptop as GM; connect its bridge using WebSocket / Local Only, host 127.0.0.1, port 31415. Start the laptop MCP connection, then refresh Foundry. Avoid competing GM bridge sessions across computers while switching.
6. Confirm portrait-bridge-status reports 1.5.0 and environmentTools:true. Use a single read-only inspection first; never reset fog as a connection test.

For a separate Foundry installation, install the upstream foundry-mcp-bridge module and copy outputs/portrait-bridge/ai-portrait-bridge into Data/modules. Enable both modules and refresh. Foundry 14 and the required GM/write permissions are expected. Plutonium lookup requires the user's separately installed Plutonium module. Worlds, artwork and other licensed modules are restored separately from the Foundry backup.

## What Git does not preserve

Git tracks integration code, tests and instructions. It does not contain world databases, campaign artwork, tokens, explored fog, SSH credentials, accounts, ComfyUI/models, process locks or live logs. Preserve the Foundry backup and generated assets separately. Scene deletion remains user-only in AGENTS.md and the tool allowlist.

## Verification

The original installation passed 32 art/scene checks, creation checks, 12 environment checks and real isolated 64-tool discovery. The fork carries the same tests with generated plain PNGs and a synthetic compressed metadata catalog for portability; see the preparation report for actual fork results. No production connection or scene mutation is needed for testing this repository.

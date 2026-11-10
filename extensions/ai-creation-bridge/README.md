# AI Creation Bridge 1.6.0

This personal extension keeps the Foundry companion module and local MCP changes together. It adds 28 tools (76 total) for portraits, maps, scenes, bounded Plutonium lookup, prepared PCs, walls, lights, vision, fog and the module integrations below. Scene deletion is user-only.

## Layout and reproducibility

- outputs/portrait-bridge/ai-portrait-bridge: deployed Foundry 14 companion source (module ID remains ai-portrait-bridge).
- outputs/portrait-bridge/local: custom local tool source and explicit tool allowlist.
- work/build-portrait-bridge.cjs: exact-anchor transformations of the pinned installed 0.8.5 server/wrapper artifacts, including startup and optional ComfyUI fixes.
- upstream-baseline: original installed bundled server/wrapper, SHA-256 manifest and distribution third-party notices. These are bundled artifacts, not a fresh TypeScript build; retaining the exact inputs makes the proven patch build independent of the old PC. The original TypeScript source and MIT license remain in the repository root.
- work: mocked tests, synthetic fixtures and isolated runtime smoke check. No Plutonium content catalog is distributed.

The extension still builds from the pinned 0.8.5 runtime artifacts. Updating that runtime requires reviewing the patch anchors and rerunning the tests independently of upstream source syncs.

## Install on another Windows computer

1. Clone your fork and check out ai-creation-bridge. Install Node 20 or newer (Node itself and optional ComfyUI are not stored in Git).
2. In this directory run npm run build, npm test, and npm run test:runtime. The extension uses bundled upstream artifacts and Node built-ins; no npm dependency installation is needed for these commands. Runtime smoke testing is currently Windows-specific and uses separate ports 31434-31436.
3. Merge codex-config.example.toml into your local Codex configuration, substituting your Node and checkout paths. Do not copy another computer's entire config. Keep ComfyUI disabled unless separately installed/configured.
4. PNG uploads default to this extension's outputs directory. FOUNDRY_UPLOAD_ROOT can override it with a dedicated folder. Readable filenames, validation, size limits and fixed server destinations ai-portraits/ai-maps remain enforced.
5. On the existing OCI server the companion is already installed. Open Foundry on the laptop as GM; connect its bridge using WebSocket / Local Only, host 127.0.0.1, port 31415. Start the laptop MCP connection, then refresh Foundry. Avoid competing GM bridge sessions across computers while switching.
6. After an upgrade, refresh the Foundry GM tab and reconnect Foundry under Codex Settings → Plugins → MCP Servers. Run `portrait-bridge-status` and confirm version 1.6.0, `environmentTools: true` and `moduleTools: true`. Run `get-module-capabilities` for a read-only check of the selected world.

For a separate Foundry installation, install the upstream foundry-mcp-bridge module and copy outputs/portrait-bridge/ai-portrait-bridge into Data/modules. Enable both modules and refresh. Foundry 14 and the required GM/write permissions are expected. Plutonium lookup requires the user's separately installed Plutonium module. Worlds, artwork and other licensed modules are restored separately from the Foundry backup.

## Module authoring

Enable each module and its dependencies in the world where you plan to use it. The adapters use the module APIs in the connected GM tab.

| Module | Tool and scope |
| --- | --- |
| Item Piles with its D&D 5e adapter | `configure-item-pile` turns an unlinked NPC token and its inventory into a merchant, chest or loot pile. |
| Monk’s Active Tiles | `manage-active-tile` sets up enter or click triggers to reveal or hide selected tokens in the same scene. |
| Tagger and Rideable | `manage-scene-tags` edits explicit tags. `manage-token-riding` mounts or dismounts named tokens using Rideable’s rules. |
| Sequencer, JB2A, GGG and SoundFx Library | `search-module-media` finds installed media in short pages. `play-module-media` plays brief audio or visual effects in the viewed scene. |
| FXMaster and Animater | `manage-fxmaster-preset` applies or removes named weather and effect presets. `use-animater-recipe` lists recipes and plays bounded visual previews. |
| Tokenizer and Monk’s TokenBar | `open-tokenizer` opens the actor’s editor for the GM to save. `use-monks-tokenbar` sets token movement rules or opens a roll request for GM review. |
| RoutingLib | `estimate-routinglib-path` computes a path for a token without moving it. |

Dice Tray, Dice So Nice, Health Estimate and Token Action HUD use the normal actor, item and dice features. SocketLib, libWrapper and the Item Piles system adapter continue to provide their native dependencies.

## What Git does not preserve

Git tracks integration code, tests and instructions. It does not contain world databases, campaign artwork, tokens, explored fog, SSH credentials, accounts, ComfyUI/models, process locks or live logs. Preserve the Foundry backup and generated assets separately. Scene deletion remains user-only in AGENTS.md and the tool allowlist.

## Verification

The test suite covers art and scene changes, character creation, environment controls and the native module calls using fixtures. The isolated runtime smoke test verifies discovery of all 76 tools and rejection of scene deletion through the MCP transport. Run these checks locally before deploying a new build.

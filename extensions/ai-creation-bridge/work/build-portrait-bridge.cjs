'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const workspace = path.resolve(__dirname, '..');
const source = path.join(workspace, 'upstream-baseline');
const expected = JSON.parse(fs.readFileSync(path.join(source, 'SHA256.json'), 'utf8'));
for (const [name, hash] of Object.entries(expected)) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(source, name))).digest('hex') !== hash) throw new Error('Upstream baseline hash mismatch: ' + name);
}
const output = path.join(workspace, 'outputs/portrait-bridge/local');
const localRoot = path.join(workspace, 'outputs');
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`Expected one exact insertion point: ${from.slice(0, 90)}`);
  return text.replace(from, to);
}
fs.mkdirSync(output, {recursive: true});
const moduleSchemaSource = fs.readFileSync(path.join(workspace, 'outputs/portrait-bridge/ai-portrait-bridge/module-schemas.mjs'), 'utf8');
const moduleSchemaCjs = replaceOnce(replaceOnce(moduleSchemaSource, 'export const definitions', 'const definitions'),
  'export function validate', 'function validate');
fs.writeFileSync(path.join(output, 'module-schemas.cjs'), moduleSchemaCjs + '\nmodule.exports = {definitions, validate};\n');
const moduleCases = require(path.join(output, 'module-schemas.cjs')).definitions
  .map(tool => '                case "' + tool.name + '":\n').join('');
let backend = fs.readFileSync(path.join(source, 'backend.bundle.cjs'), 'utf8');
const upstreamSha256 = crypto.createHash('sha256').update(backend).digest('hex');
backend = replaceOnce(backend, '  const allTools = [',
  `  const portraitTools = require('./portrait-tools.cjs').createPortraitTools(foundryClient, path4.resolve(process.env.FOUNDRY_UPLOAD_ROOT || path4.join(__dirname, "../..")));\n  const allTools = [\n    ...portraitTools.definitions,`);
backend = replaceOnce(backend, '                case "manage-actors":',
  '                case "portrait-bridge-status":\n                case "upload-portrait":\n                case "set-actor-artwork":\n                case "upload-map":\n                case "get-scene-map":\n                case "set-scene-map":\n                case "create-scene-from-map":\n                case "search-plutonium":\n                case "get-plutonium-entry":\n                case "create-player-character":\n                case "get-scene-environment":\n                case "manage-scene-walls":\n                case "manage-scene-lights":\n                case "set-scene-visibility":\n                case "set-token-vision":\n                case "reset-scene-fog":\n                  result = await portraitTools.handle(name, args);\n                  break;\n                case "manage-actors":');
backend = replaceOnce(backend, '                case "portrait-bridge-status":', moduleCases + '                case "portrait-bridge-status":');
backend = replaceOnce(backend, '  const portraitTools = require', '  const {assertAllowedTool} = require("./tool-policy.cjs");\n  const portraitTools = require');
backend = replaceOnce(backend, '  const server = net.createServer((socket) => {', '  allTools.forEach(tool => assertAllowedTool(tool.name));\n  const server = net.createServer((socket) => {');
backend = replaceOnce(backend, '              let result;', '              assertAllowedTool(name);\n              let result;');
backend = replaceOnce(backend, 'var CONTROL_PORT = 31414;', 'var CONTROL_PORT = Number(process.env.FOUNDRY_CONTROL_PORT || 31414);');
backend = replaceOnce(backend, 'path4.join(os.tmpdir(), "foundry-mcp-backend.lock")', 'path4.join(__dirname, `portrait-backend-${CONTROL_PORT}.lock`)');
backend = replaceOnce(backend, '  const server = net.createServer((socket) => {',
  '  const server = net.createServer((socket) => {\n    socket.on("error", error => { logger.warn("Control client disconnected", {code: error.code}); });');
backend = replaceOnce(backend, 'const WEBRTC_PORT = 31416;', 'const WEBRTC_PORT = Number(process.env.FOUNDRY_SIGNALING_PORT || 31416);');
backend = replaceOnce(backend, 'reject(new Error(`Query timeout: ${method}`));\n      }, 1e4);',
  'reject(new Error(`Query timeout: ${method}`));\n      }, method.startsWith("ai-portrait-bridge.module.") || ["ai-portrait-bridge.upload", "ai-portrait-bridge.uploadMap", "ai-portrait-bridge.searchPlutonium", "ai-portrait-bridge.getPlutoniumEntry", "ai-portrait-bridge.createPlayerCharacter", "ai-portrait-bridge.manageWalls", "ai-portrait-bridge.manageLights"].includes(method) ? 60000 : 10000);');
// Use explicit ComfyUI configuration; keep the second legacy auto-start path disabled.
backend = replaceOnce(backend, '        port: config.comfyui?.port || 31411',
  '        ...config.comfyui,\n        autoStart: process.env.COMFYUI_AUTO_START === "true"');
backend = replaceOnce(backend, '        const isInstalled = await this.checkInstallation();',
  '        if ((await this.checkHealth()).available) { this.logger.info("Using the running local ComfyUI service"); return; }\n        const isInstalled = await this.checkInstallation();');
backend = replaceOnce(backend, '          mainPyPath,', '          "-s",\n          mainPyPath,');
backend = replaceOnce(backend, '        const logPath = path3.join(getAppDataDir(), "comfyui.log");',
  '        const logPath = path3.join(__dirname, "comfyui.log");');
backend = replaceOnce(backend, '        this.logStream = fss.createWriteStream(logPath, { flags: "a" });',
  '        this.logStream = fss.createWriteStream(logPath, { flags: "a" });\n        this.logStream.on("error", error => { this.logger.warn("Optional ComfyUI log unavailable", {message: error.message}); this.logStream = null; });');
backend = replaceOnce(backend, '          this.logger.error("ComfyUI process error", { error: error.message });',
  '          this.logger.error("ComfyUI process error", { error: error.message });\n          this.process = void 0;');
backend = replaceOnce(backend, '          await mapGenerationComfyUIClient.startService();\n          logger.info("ComfyUI service auto-started successfully");',
  '          void mapGenerationComfyUIClient.startService().then(() => logger.info("ComfyUI service auto-started successfully")).catch(error => logger.warn("Optional ComfyUI startup failed", {message: error.message}));\n          logger.info("Optional ComfyUI startup scheduled; MCP discovery continues immediately");');
backend = replaceOnce(backend, '    comfyuiStatus = "starting";\n    logger.info("Starting ComfyUI service...");',
  '    try { await waitForComfyUIReady(1000); comfyuiStatus = "running"; return {status: "already_running", message: "Using the running local ComfyUI service"}; } catch {}\n    comfyuiStatus = "starting";\n    logger.info("Starting ComfyUI service...");');
backend = replaceOnce(backend, '  void autoStartComfyUI();', '  // Optional ComfyUI auto-start disabled in the portrait runtime.');
let wrapper = fs.readFileSync(path.join(source, 'index.cjs'), 'utf8');
wrapper = replaceOnce(wrapper, 'var CONTROL_PORT = 31414;', 'var CONTROL_PORT = Number(process.env.FOUNDRY_CONTROL_PORT || 31414);');
wrapper = replaceOnce(wrapper, '(process.execPath, [backendPath], {', '(process.execPath, [...process.execArgv, backendPath], {');
wrapper = replaceOnce(wrapper, '      this.backendProcess = child;',
  '      child.stderr.on("data", chunk => { this.log("backend stderr", {message: chunk.toString().slice(0, 4000)}); });\n      this.backendProcess = child;');
wrapper = replaceOnce(wrapper, '        this.backendProcess = null;\n        if (code === 0) {\n          this.log("startBackend(): backend exited cleanly (likely lock failure), exiting wrapper");\n          process.exit(0);',
  '        if (this.backendProcess === child) this.backendProcess = null;\n        if (code === 0) {\n          this.log("startBackend(): another backend may own the lock; keeping MCP wrapper available");');
fs.writeFileSync(path.join(output, 'backend.bundle.cjs'), backend);
fs.writeFileSync(path.join(output, 'index.cjs'), wrapper);
fs.copyFileSync(path.join(workspace, 'outputs/portrait-bridge/ai-portrait-bridge/portrait-policy.mjs'), path.join(output, 'portrait-policy.mjs'));
fs.copyFileSync(path.join(workspace, 'outputs/portrait-bridge/ai-portrait-bridge/creation-policy.mjs'), path.join(output, 'creation-policy.mjs'));
fs.copyFileSync(path.join(workspace, 'outputs/portrait-bridge/ai-portrait-bridge/environment-policy.mjs'), path.join(output, 'environment-policy.mjs'));
fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify({extensionVersion: '1.6.0', upstreamVersion: '0.8.5', upstreamSha256, localRoot: "FOUNDRY_UPLOAD_ROOT or extension outputs directory", toolsAdded: 28}, null, 2));
console.log(JSON.stringify({output, upstreamSha256, toolsAdded: 28}));

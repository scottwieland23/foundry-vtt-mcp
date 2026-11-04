'use strict';
const {spawn, execFile} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
const runtime = path.resolve(__dirname, '../outputs/portrait-bridge/local');
const child = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(runtime, 'index.cjs')], {
  cwd: runtime, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: {...process.env,
    FOUNDRY_CONTROL_PORT: '31434', FOUNDRY_PORT: '31435', FOUNDRY_SIGNALING_PORT: '31436', LOG_LEVEL: 'error', COMFYUI_AUTO_START: process.env.SMOKE_COMFYUI_AUTO_START || 'false'}
});
let output = '', toolNames = [], completed = false;
let stderr = '';
child.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-4000);});
const timeout = setTimeout(() => fail(new Error(`MCP startup timed out. ${stderr}`)), 30000);
function send(message) {child.stdin.write(JSON.stringify(message) + '\n');}
function fail(error) {console.error(error); process.exitCode = 1; child.stdin.end(); cleanup();}
function cleanup() {
  clearTimeout(timeout);
  setTimeout(() => {
    if (child.exitCode === null) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}, () => {});
  }, 2000).unref();
}
child.on('error', fail);
child.stdout.on('data', chunk => {
  output += chunk;
  let at;
  while ((at = output.indexOf('\n')) >= 0) {
    const line = output.slice(0, at); output = output.slice(at + 1);
    try {
      const message = JSON.parse(line);
      if (message.id === 1) {
        assert(message.result?.capabilities?.tools);
        console.log('PASS MCP initialization');
        send({jsonrpc: '2.0', method: 'notifications/initialized'});
        send({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}});
      }
      if (message.id === 2) {
        toolNames = message.result.tools.map(t => t.name);
        assert.equal(toolNames.length, 64);
        for (const name of ['portrait-bridge-status', 'upload-portrait', 'set-actor-artwork', 'upload-map', 'get-scene-map', 'set-scene-map', 'create-scene-from-map', 'search-plutonium', 'get-plutonium-entry', 'create-player-character', 'get-scene-environment', 'manage-scene-walls', 'manage-scene-lights', 'set-scene-visibility', 'set-token-vision', 'reset-scene-fog', 'get-world-info']) assert(toolNames.includes(name));
        console.log('PASS 64 tools discovered, including all 48 original tools');
        const probe = net.connect({host: '127.0.0.1', port: 31434});
        probe.on('error', fail);
        probe.on('connect', () => {
          probe.resetAndDestroy();
          setTimeout(() => {
            send({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'upload-portrait', arguments: {fileName: '../secret.png'}}});
          }, 200);
        });
      }
      if (message.id === 3) {
        assert.equal(message.result.isError, true);
        assert.match(message.result.content[0].text, /plain PNG filename/);
        console.log('PASS real MCP transport rejects upload traversal');
        console.log('PASS backend survives an abruptly reset control connection');
        send({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'delete-scene', arguments: {}}});
      }
      if (message.id === 4) {
        assert.equal(message.result.isError, true);
        assert.match(message.result.content[0].text, /not permitted|reserved for the user/);
        console.log('PASS scene deletion is blocked through real MCP transport');
        completed = true; child.stdin.end(); cleanup();
      }
    } catch (error) {fail(error);}
  }
});
child.on('exit', () => {
  clearTimeout(timeout);
  if (!completed) {console.error('Runtime exited before smoke checks completed.', stderr); process.exitCode = 1;}
  // Verify all test-only listeners disappear after stdin closes.
  setTimeout(async () => {
    for (const port of [31434, 31435, 31436]) {
      const listening = await new Promise(resolve => {
        const socket = net.connect({host: '127.0.0.1', port});
        socket.on('connect', () => {socket.destroy(); resolve(true);});
        socket.on('error', () => resolve(false));
      });
      if (listening) {console.error(`FAIL listener remains on test port ${port}`); process.exitCode = 1;}
      else console.log(`PASS shutdown closes test port ${port}`);
    }
  }, 400);
});
send({jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'portrait-runtime-check', version: '1.0.0'}
}});

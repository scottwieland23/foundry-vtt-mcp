'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {webcrypto, createHash} = require('node:crypto');
const {File} = require('node:buffer');
const root = path.resolve(__dirname, '../outputs/portrait-bridge');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

(async () => {
  const policy = await import(pathToFileURL(path.join(root, 'ai-portrait-bridge/portrait-policy.mjs')).href);
  const png = await fs.readFile(path.resolve(__dirname, '../outputs/vhalzareth-portrait.png'));
  const hash = createHash('sha256').update(png).digest('hex');
  const expectedPath = policy.portraitPath(hash, 'vhalzareth-portrait.png');
  const {createPortraitTools, readBoundedPng, definitions} = require('../outputs/portrait-bridge/local/portrait-tools.cjs');
  await test('synthetic portrait passes PNG dimensions and content policy', () => {
    assert.deepEqual(policy.validatePng(png), {width: 1254, height: 1254, bytes: png.length});
  });
  await test('reject traversal, absolute paths, encodings, alternate streams, nested files and non-PNG names', () => {
    for (const name of ['../secret.png', '..\\secret.png', '/tmp/a.png', 'C:\\a.png', 'a.png:stream', 'x/a.png', '%2e%2e.png', 'x.svg', 'x.PNG', '', 'a..png']) {
      assert.throws(() => policy.validateLocalName(name), undefined, name);
    }
  });
  await test('reject every destination outside the single fixed folder', () => {
    for (const value of ['ai-portraits/../secret.png', `ai-portraits/sub/${hash}.png`, `https://example.com/${hash}.png`, `other/${hash}.png`, `ai-portraits/${hash}.svg`, `ai-portraits/%2e%2e/${hash}.png`]) {
      assert.throws(() => policy.validatePortraitPath(value));
    }
  });
  await test('readable filenames are deterministic, safe, and versioned while legacy paths still validate', () => {
    assert.equal(expectedPath, `ai-portraits/vhalzareth-portrait--${hash.slice(0, 12)}.png`);
    assert.equal(policy.portraitPath(hash, 'Ashen_Veil_Knife.png'), `ai-portraits/ashen-veil-knife--${hash.slice(0, 12)}.png`);
    policy.validatePortraitPath(expectedPath);
    policy.validatePortraitPath(policy.portraitPath(hash));
    assert.throws(() => policy.portraitPath(hash, '../escape.png'));
  });
  await test('reject invalid formats, truncated files, excess dimensions, oversized files and trailing payloads', () => {
    assert.throws(() => policy.validatePng(Buffer.from('<svg/>')));
    assert.throws(() => policy.validatePng(png.subarray(0, 100)));
    const large = Buffer.from(png); large.writeUInt32BE(100000, 16);
    assert.throws(() => policy.validatePng(large));
    assert.throws(() => policy.validatePng(Buffer.alloc(policy.MAX_BYTES + 1)));
    assert.throws(() => policy.validatePng(Buffer.concat([png, Buffer.from('trailing script')])));
  });
  await test('reject malformed base64 before decoding', () => {
    for (const value of ['!!!!', png.toString('base64') + '==', 'data:image/png;base64,AAAA']) {
      assert.throws(() => policy.decodePayload(value, text => Buffer.from(text, 'base64')));
    }
  });
  await test('bound local reads and reject oversized files without uploading', async () => {
    const content = await readBoundedPng(path.resolve(__dirname, '../outputs'), 'vhalzareth-portrait.png', policy);
    assert.equal(createHash('sha256').update(content).digest('hex'), hash);
    await assert.rejects(() => readBoundedPng(path.resolve(__dirname, '../outputs'), '../secret.png', policy));
    const dir = path.join(__dirname, 'portrait-test-files'); await fs.mkdir(dir, {recursive: true});
    await fs.writeFile(path.join(dir, 'oversize.png'), Buffer.alloc(policy.MAX_BYTES + 1));
    await assert.rejects(() => readBoundedPng(dir, 'oversize.png', policy), /limit/);
  });

  const calls = [];
  const client = {query: async (name, args) => {
    calls.push({name, args});
    if (name.endsWith('.status')) return {version: '1.5.0', sceneCreation: true, sceneDeletionAllowed: false, folder: policy.FOLDER, mapFolder: policy.MAP_FOLDER, enabled: true, bridgeWritesEnabled: true};
    if (name.endsWith('.upload')) return {success: true, path: policy.portraitPath(args.sha256, args.fileName)};
    if (name.endsWith('.uploadMap')) return {success: true, path: policy.mapPath(args.sha256, args.fileName)};
    return {success: true};
  }};
  const tools = createPortraitTools(client, path.resolve(__dirname, '../outputs'));
  await test('MCP upload sends verified PNG to the fixed companion handler', async () => {
    const result = await tools.handle('upload-portrait', {fileName: 'vhalzareth-portrait.png'});
    assert.equal(result.path, expectedPath);
    assert.equal(calls.at(-1).name, 'ai-portrait-bridge.upload');
    assert.equal(calls.at(-1).args.sha256, hash);
    assert.equal(Buffer.from(calls.at(-1).args.base64, 'base64').compare(png), 0);
  });
  await test('MCP caller cannot select a destination or arbitrary local file', async () => {
    await assert.rejects(() => tools.handle('upload-portrait', {fileName: 'vhalzareth-portrait.png', destination: 'worlds'}));
    await assert.rejects(() => tools.handle('upload-portrait', {fileName: '../secret.png'}));
    assert.equal(definitions.length, 28);
    assert(definitions.every(d => d.inputSchema.additionalProperties === false));
  });

  const hooks = new Map();
  global.Hooks = {once: (name, cb) => hooks.set(name, cb)};
  global.CONFIG = {queries: {}};
  let bitmapCalls = 0;
  global.createImageBitmap = async blob => { bitmapCalls++; const data = new DataView(await blob.arrayBuffer()); return {width: data.getUint32(16), height: data.getUint32(20), close() {}}; };
  global.ui = {notifications: {info() {}}};
  const settings = new Map([['foundry-mcp-bridge.enabled', true], ['foundry-mcp-bridge.allowWriteOperations', true], ['ai-portrait-bridge.enabled', true]]);
  const actorId = 'z6ouceQIB0hIEKz4';
  const sceneId = '22h4aXB10oozGwOR';
  const actor = {id: actorId, img: 'old-portrait.png', prototypeToken: {texture: {src: 'old-prototype.png', scaleX: 2, scaleY: 2}},
    async update(change) { this.img = change.img; for (const key of ['src', 'scaleX', 'scaleY']) if (change[`prototypeToken.texture.${key}`] !== undefined) this.prototypeToken.texture[key] = change[`prototypeToken.texture.${key}`]; }};
  const token = {id: 'hFCsKLYU4t3a2IKr', actorId, texture: {src: 'old-token.png', scaleX: 2, scaleY: 2}, x: 1425, y: 800, width: 1, height: 1, hidden: false, rotation: 90, hp: 68};
  const other = {id: 'unrelatedtoken01', actorId: 'anotheractor0001', texture: {src: 'leave-me.png'}};
  let failTokens = false;
  const scene = {id: sceneId, tokens: new Map([[token.id, token], [other.id, other]]),
    async updateEmbeddedDocuments(type, updates) {
      if (failTokens) throw new Error('simulated network failure');
      assert.equal(type, 'Token');
      for (const change of updates) {
        assert.deepEqual(Object.keys(change), ['_id', 'texture.src', 'texture.scaleX', 'texture.scaleY']);
        for (const key of ['src', 'scaleX', 'scaleY']) this.tokens.get(change._id).texture[key] = change[`texture.${key}`];
      }
    }};
  // Foundry collections iterate documents rather than Map [key,value] entries.
  scene.tokens[Symbol.iterator] = function* () { yield* this.values(); };
  scene.name = 'Existing Scene'; scene.width = 1448; scene.height = 1086; scene.padding = 0.25;
  scene._source = {grid: {type: 1, size: 25, distance: 5, units: 'ft'}};
  const level = {id: 'defaultLevel0000', name: 'Ground', _source: {background: {src: 'old-map.png', offsetX: 7, offsetY: 11, scaleX: 1, scaleY: 1}}};
  level.background = level._source.background;
  scene.levels = new Map([[level.id, level]]);
  scene.levels[Symbol.iterator] = function* () { yield* this.values(); };
  const updateTokens = scene.updateEmbeddedDocuments.bind(scene);
  scene.updateEmbeddedDocuments = async (type, updates) => {
    if (type === 'Token') return updateTokens(type, updates);
    assert.equal(type, 'Level');
    for (const update of updates) {
      assert.deepEqual(Object.keys(update), ['_id', 'background.src']);
      scene.levels.get(update._id).background.src = update['background.src'];
    }
  };
  global.game = {user: {isGM: true}, actors: new Map([[actorId, actor]]), scenes: new Map([[sceneId, scene]]),
    modules: new Map([['foundry-mcp-bridge', {active: true}], ['ai-portrait-bridge', {active: true}]]),
    settings: {get: (scope, key) => settings.get(`${scope}.${key}`), register() {}}};
  global.canvas = {scene};
  const remoteFiles = new Map(); const folders = new Set(); let uploadCount = 0;
  const fakePicker = {
    async browse(source, target) {
      assert.equal(source, 'data');
      if (target === '') return {dirs: [...folders]};
      assert(['ai-portraits', 'ai-maps'].includes(target));
      return {files: [...remoteFiles.keys()].filter(key => key.startsWith(target + '/'))};
    },
    async createDirectory(source, target) { assert.equal(source, 'data'); assert(['ai-portraits', 'ai-maps'].includes(target)); folders.add(target); },
    async upload(source, target, file) {
      assert.equal(source, 'data'); assert(['ai-portraits', 'ai-maps'].includes(target)); assert.match(file.name, /^[a-z0-9_-]+--[a-f0-9]{12}\.png$/);
      const filePath = `${target}/${file.name}`;
      assert(!remoteFiles.has(filePath), 'Never overwrite an existing file');
      remoteFiles.set(filePath, Buffer.from(await file.arrayBuffer())); uploadCount++;
      return {path: filePath};
    }
  };
  global.document = {baseURI: 'https://foundry.example/game'};
  global.fetch = async url => {
    const file = remoteFiles.get(new URL(url).pathname.slice(1));
    return file ? new Response(file) : new Response('', {status: 404});
  };
  global.foundry = {applications: {apps: {FilePicker: {implementation: fakePicker}}}};
  const module = await import(pathToFileURL(path.join(root, 'ai-portrait-bridge/portrait-module.mjs')).href);
  await hooks.get('init')(); await hooks.get('ready')();
  const uploadArgs = {base64: png.toString('base64'), sha256: hash, fileName: 'vhalzareth-portrait.png'};
  await test('companion rejects non-GM callers and disabled writes', async () => {
    game.user.isGM = false; await assert.rejects(() => module.uploadPortrait(uploadArgs), /Game Master/);
    game.user.isGM = true; settings.set('foundry-mcp-bridge.allowWriteOperations', false);
    await assert.rejects(() => module.uploadPortrait(uploadArgs), /writes are disabled/);
    settings.set('foundry-mcp-bridge.allowWriteOperations', true);
    settings.set('ai-portrait-bridge.enabled', false); await assert.rejects(() => module.uploadPortrait(uploadArgs), /disabled/);
    settings.set('ai-portrait-bridge.enabled', true);
    assert.equal(uploadCount, 0);
  });
  await test('companion independently rejects destination injection and mismatched hash', async () => {
    await assert.rejects(() => module.uploadPortrait({...uploadArgs, folder: '../worlds'}));
    await assert.rejects(() => module.uploadPortrait({...uploadArgs, sha256: '0'.repeat(64)}), /hash/);
    assert.equal(uploadCount, 0);
  });
  await test('companion creates only ai-portraits and uploads verified bytes once', async () => {
    const result = await module.uploadPortrait(uploadArgs);
    assert.equal(result.path, expectedPath); assert.equal(result.reused, false);
    assert.equal(uploadCount, 1); assert.equal(remoteFiles.get(expectedPath).compare(png), 0);
    assert.equal(bitmapCalls, 1);
  });
  await test('repeat and concurrent uploads reuse content without replacing a file', async () => {
    const results = await Promise.all([module.uploadPortrait(uploadArgs), module.uploadPortrait(uploadArgs)]);
    assert(results.every(r => r.reused)); assert.equal(uploadCount, 1);
  });
  await test('short-hash filename collision is rejected without replacing existing content', async () => {
    remoteFiles.set(expectedPath, Buffer.from('different contents'));
    await assert.rejects(() => module.uploadPortrait(uploadArgs), /collision/);
    assert.equal(uploadCount, 1);
    remoteFiles.set(expectedPath, png);
  });
  await test('artwork update changes portrait, prototype and matching tokens without altering other state', async () => {
    const result = await module.setArtwork({actorId, path: expectedPath, updateSceneTokens: true, sceneId});
    assert.equal(actor.img, expectedPath); assert.equal(actor.prototypeToken.texture.src, expectedPath);
    assert.equal(token.texture.src, expectedPath); assert.equal(other.texture.src, 'leave-me.png');
    assert.deepEqual([token.texture.scaleX, token.texture.scaleY, actor.prototypeToken.texture.scaleX, actor.prototypeToken.texture.scaleY], [1, 1, 1, 1]);
    assert.deepEqual([token.width, token.height], [1, 1]);
    assert.deepEqual([token.x, token.y, token.hidden, token.rotation, token.hp], [1425, 800, false, 90, 68]);
    assert.deepEqual(result.updatedTokenIds, [token.id]);
    assert.equal(result.previous.portrait, 'old-portrait.png');
  });
  await test('unuploaded paths and arbitrary update fields are rejected', async () => {
    await assert.rejects(() => module.setArtwork({actorId, path: policy.portraitPath('1'.repeat(64))}), /Upload/);
    await assert.rejects(() => module.setArtwork({actorId, path: expectedPath, hidden: true}), /Unexpected/);
    await assert.rejects(() => module.setArtwork({actorId, path: 'ai-test/old.png'}));
  });
  await test('partial scene write returns an actionable failure and can be retried', async () => {
    failTokens = true;
    await assert.rejects(() => module.setArtwork({actorId, path: expectedPath, updateSceneTokens: true}), /Actor artwork was saved/);
    failTokens = false;
    assert.equal((await module.setArtwork({actorId, path: expectedPath, updateSceneTokens: true})).success, true);
  });
  await test('core companion handlers register with the existing bridge namespace', async () => {
    assert.deepEqual(Object.keys(CONFIG.queries).filter(name => !name.startsWith("ai-portrait-bridge.module.")).sort(), ['ai-portrait-bridge.createPlayerCharacter', 'ai-portrait-bridge.createSceneFromMap', 'ai-portrait-bridge.getPlutoniumEntry', 'ai-portrait-bridge.getSceneMap', 'ai-portrait-bridge.manageLights', 'ai-portrait-bridge.manageWalls', 'ai-portrait-bridge.readEnvironment', 'ai-portrait-bridge.resetFog', 'ai-portrait-bridge.searchPlutonium', 'ai-portrait-bridge.setArtwork', 'ai-portrait-bridge.setSceneMap', 'ai-portrait-bridge.setTokenVision', 'ai-portrait-bridge.setVisibility', 'ai-portrait-bridge.status', 'ai-portrait-bridge.upload', 'ai-portrait-bridge.uploadMap']);
    assert.equal((await CONFIG.queries['ai-portrait-bridge.status']()).folder, 'ai-portraits');
  });
  const map = await fs.readFile(path.resolve(__dirname, '../outputs/long-table-fountain-square.png'));
  const mapHash = createHash('sha256').update(map).digest('hex');
  const mapPath = policy.mapPath(mapHash, 'long-table-fountain-square.png');
  const mapArgs = {base64: map.toString('base64'), sha256: mapHash, fileName: 'long-table-fountain-square.png'};
  await test('map filenames and assignments cannot cross portrait or map folder boundaries', () => {
    assert.match(mapPath, /^ai-maps\/long-table-fountain-square--[a-f0-9]{12}\.png$/);
    policy.validateMapPath(mapPath);
    assert.throws(() => policy.validateMapPath(expectedPath));
    assert.throws(() => policy.validatePortraitPath(mapPath));
    assert.throws(() => policy.mapPath(mapHash, '../escape.png'));
    assert.throws(() => policy.validateSceneMapArgs({sceneId, path: mapPath, width: 9000}, true));
  });
  await test('map size limits are separate from portrait limits', () => {
    assert.equal(policy.MAP_LIMITS.maxBytes, 25 * 1024 * 1024);
    const header = Buffer.from(map); header.writeUInt32BE(6000, 16);
    assert.throws(() => policy.validatePng(header));
    assert.equal(policy.validatePng(header, policy.MAP_LIMITS).width, 6000);
    header.writeUInt32BE(8193, 16);
    assert.throws(() => policy.validatePng(header, policy.MAP_LIMITS));
    assert.throws(() => policy.validatePng(Buffer.alloc(policy.MAP_LIMITS.maxBytes + 1), policy.MAP_LIMITS));
  });
  await test('MCP map upload sends real map bytes only to the dedicated map handler', async () => {
    const result = await tools.handle('upload-map', {fileName: 'long-table-fountain-square.png'});
    assert.equal(result.path, mapPath);
    assert.equal(calls.at(-1).name, 'ai-portrait-bridge.uploadMap');
    await assert.rejects(() => tools.handle('upload-map', {fileName: 'long-table-fountain-square.png', folder: 'worlds'}));
  });
  await test('companion creates only the map folder and reuses verified map files', async () => {
    const result = await module.uploadMap(mapArgs);
    assert.equal(result.path, mapPath); assert.equal(result.width, 1448); assert.equal(result.height, 1086);
    assert.deepEqual([...folders].sort(), ['ai-maps', 'ai-portraits']);
    assert.equal(remoteFiles.get(mapPath).compare(map), 0);
    assert.equal((await module.uploadMap(mapArgs)).reused, true);
  });
  await test('map assignment preserves grid, dimensions, transforms and token state', async () => {
    const layout = await module.getSceneMap({sceneId});
    const positions = [...scene.tokens].map(t => ({id: t.id, x: t.x, y: t.y, width: t.width, height: t.height}));
    const result = await module.setSceneMap({sceneId, path: mapPath});
    assert.equal(level.background.src, mapPath); assert.equal(result.levelId, level.id); assert(result.layoutPreserved);
    const after = await module.getSceneMap({sceneId});
    assert.deepEqual([after.width, after.height, after.padding, after.grid], [layout.width, layout.height, layout.padding, layout.grid]);
    assert.deepEqual({...level.background, src: 'old-map.png'}, result.previousBackground);
    assert.deepEqual([...scene.tokens].map(t => ({id: t.id, x: t.x, y: t.y, width: t.width, height: t.height})), positions);
  });
  await test('multi-level scenes require explicit selection and wrong folders are rejected', async () => {
    const second = {id: 'secondLevel00000', name: 'Upper', _source: {background: {src: 'upper.png'}}, background: {src: 'upper.png'}};
    scene.levels.set(second.id, second);
    await assert.rejects(() => module.setSceneMap({sceneId, path: mapPath}), /levelId/);
    assert.equal((await module.setSceneMap({sceneId, levelId: level.id, path: mapPath})).success, true);
    assert.equal(second.background.src, 'upper.png');
    await assert.rejects(() => module.setSceneMap({sceneId, path: expectedPath}));
    await assert.rejects(() => module.setArtwork({actorId, path: mapPath}));
    scene.levels.delete(second.id);
  });
  await test('map uploads and assignments honor GM and write gates', async () => {
    game.user.isGM = false;
    await assert.rejects(() => module.uploadMap(mapArgs), /Game Master/);
    await assert.rejects(() => module.getSceneMap({sceneId}), /Game Master/);
    game.user.isGM = true;
    settings.set('foundry-mcp-bridge.allowWriteOperations', false);
    await assert.rejects(() => module.setSceneMap({sceneId, path: mapPath}), /disabled/);
    settings.set('foundry-mcp-bridge.allowWriteOperations', true);
  });
  game.scenes[Symbol.iterator] = function* () { yield* this.values(); };
  let createCalls = 0, failCreate = false, corruptCreate = false;
  CONFIG.Scene = {documentClass: {async create(data, options) {
    createCalls++;
    assert.equal(options.renderSheet, false);
    assert.equal(data.active, false); assert.equal(data.navigation, false);
    assert.deepEqual(data.ownership, {default: 0});
    if (failCreate) throw new Error('simulated create failure');
    const createdLevel = {id: 'newGroundLevel01', name: 'Ground', _source: {background: structuredClone(data.levels[0].background)}};
    createdLevel.background = createdLevel._source.background;
    const created = {...structuredClone(data), id: `newScene${String(createCalls).padStart(8, '0')}`,
      _source: {grid: structuredClone(data.grid)}, levels: new Map([[createdLevel.id, createdLevel]])};
    created.levels[Symbol.iterator] = function* () { yield* this.values(); };
    if (corruptCreate) created.width++;
    game.scenes.set(created.id, created);
    return created;
  }}};
  const creation = {requestId: 'scene-request-test-001', name: 'Moonlit Test Square', path: mapPath, width: 1448, height: 1086, gridSize: 25};
  await test('scene creation validates bounded dimensions, grid and strict fields on both bridge sides', async () => {
    for (const patch of [{action: 'delete'}, {sceneId}, {deleteIds: [sceneId]}, {active: true}, {width: 0}, {height: 8193}, {width: 1.5}, {gridSize: 19}, {gridType: 2}, {gridDistance: 0}, {padding: 0.13}, {gridUnits: '<script>'}, {requestId: 'short'}, {name: '<b>bad</b>'}, {path: expectedPath}]) {
      assert.throws(() => policy.validateCreateSceneArgs({...creation, ...patch}));
      await assert.rejects(() => module.createSceneFromMap({...creation, ...patch}));
      await assert.rejects(() => tools.handle('create-scene-from-map', {...creation, ...patch}));
    }
    assert.equal(createCalls, 0);
  });
  await test('scene creation requires GM, enabled writes and an uploaded map', async () => {
    game.user.isGM = false;
    await assert.rejects(() => module.createSceneFromMap(creation), /Game Master/);
    game.user.isGM = true;
    settings.set('foundry-mcp-bridge.allowWriteOperations', false);
    await assert.rejects(() => module.createSceneFromMap(creation), /disabled/);
    settings.set('foundry-mcp-bridge.allowWriteOperations', true);
    await assert.rejects(() => module.createSceneFromMap({...creation, path: policy.mapPath('0'.repeat(64), 'missing.png')}), /Upload/);
    assert.equal(createCalls, 0);
  });
  await test('creates a single inactive scene with the map, dimensions and 25-pixel grid', async () => {
    const previous = JSON.stringify(await module.getSceneMap({sceneId}));
    const count = game.scenes.size;
    const result = await module.createSceneFromMap(creation);
    assert(result.success); assert.equal(result.reused, false);
    assert.equal(result.levels[0].background.src, mapPath);
    assert.deepEqual([result.width, result.height, result.grid.size, result.grid.distance, result.grid.units], [1448, 1086, 25, 5, 'ft']);
    assert.equal(game.scenes.size, count + 1); assert.equal(createCalls, 1);
    assert.equal(canvas.scene, scene);
    assert.equal(JSON.stringify(await module.getSceneMap({sceneId})), previous);
  });
  await test('repeated and concurrent scene requests return the original without duplicates', async () => {
    const results = await Promise.all([module.createSceneFromMap(creation), module.createSceneFromMap(creation)]);
    assert(results.every(r => r.reused)); assert.equal(results[0].sceneId, results[1].sceneId); assert.equal(createCalls, 1);
    await assert.rejects(() => module.createSceneFromMap({...creation, width: 1500}), /different scene settings/);
    await assert.rejects(() => module.createSceneFromMap({...creation, requestId: 'different-request-001'}), /name already exists/);
    assert.equal(createCalls, 1);
  });
  await test('creation failures never delete scenes, and saved partial scenes do not duplicate on retry', async () => {
    const before = game.scenes.size;
    failCreate = true;
    const failure = {...creation, name: 'Failure Test', requestId: 'failure-request-001'};
    await assert.rejects(() => module.createSceneFromMap(failure), /simulated/);
    assert.equal(game.scenes.size, before);
    failCreate = false; corruptCreate = true;
    await assert.rejects(() => module.createSceneFromMap(failure), /No scene was deleted/);
    const count = game.scenes.size, callsBefore = createCalls;
    await assert.rejects(() => module.createSceneFromMap(failure), /No scene was deleted/);
    assert.equal(game.scenes.size, count); assert.equal(createCalls, callsBefore);
    assert(game.scenes.has(sceneId)); corruptCreate = false;
  });
  await test('local MCP creation dispatch passes only normalized creation fields', async () => {
    await tools.handle('create-scene-from-map', creation);
    assert.equal(calls.at(-1).name, 'ai-portrait-bridge.createSceneFromMap');
    assert.deepEqual(calls.at(-1).args, policy.validateCreateSceneArgs(creation));
  });
  await test('tool policy rejects scene deletion and arbitrary execution while retaining other reviewed capabilities', async () => {
    const {assertAllowedTool} = require('../outputs/portrait-bridge/local/tool-policy.cjs');
    for (const name of ['delete-scene', 'delete-scenes', 'manage-scenes', 'execute-script', 'eval', 'unknown']) assert.throws(() => assertAllowedTool(name), /reserved for the user/);
    for (const name of ['create-scene-from-map', 'set-scene-map', 'manage-actors', 'get-world-info']) assertAllowedTool(name);
    const status = await CONFIG.queries['ai-portrait-bridge.status']();
    assert.equal(status.sceneDeletionAllowed, false); assert.equal(status.sceneCreation, true);
    assert.equal(status.version, '1.6.0');
    assert(!Object.keys(CONFIG.queries).some(name => /delete/i.test(name)));
    const code = await fs.readFile(path.join(root, 'ai-portrait-bridge/portrait-module.mjs'), 'utf8');
    assert(!/\.delete(?:Documents)?\s*\(/.test(code), 'Companion must never delete a document, including error cleanup');
  });
  console.log(`ALL ${passed} TESTS PASSED`);
})().catch(error => {console.error(error); process.exitCode = 1;});

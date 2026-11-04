'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');

const NAMESPACE = 'ai-portrait-bridge';
const definition = (name, description, properties, required, readOnly = false) => ({
  name, description,
  inputSchema: {type: 'object', properties, required, additionalProperties: false},
  annotations: {readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false}
});
const creationTools = require('./creation-tools.cjs');
const environmentTools = require('./environment-tools.cjs');
const definitions = [
  ...creationTools.definitions,
  ...environmentTools.definitions,
  definition('portrait-bridge-status', 'Check whether the dedicated-folder portrait companion is enabled in the connected Foundry world.', {}, [], true),
  definition('upload-portrait', 'Upload a PNG from the configured local artwork folder to the fixed Foundry ai-portraits folder. Supply a plain filename, never an absolute path. The server keeps a readable filename plus a short content-hash version suffix. Maximum 5 MiB and 4096 pixels per side. Destination folders cannot be selected.',
    {fileName: {type: 'string', description: 'Plain filename in the configured local artwork folder, for example vhalzareth-portrait.png.'}}, ['fileName']),
  definition('set-actor-artwork', 'Assign an uploaded ai-portraits image to a world actor. Updated prototype and scene-token artwork use scale 1.0, preserving their grid footprint. Optionally update matching tokens in one selected scene. Position, rotation, visibility and statistics are preserved.', {
    actorId: {type: 'string', description: 'World actor ID.'},
    path: {type: 'string', description: 'Exact named ai-portraits PNG path returned by upload-portrait; legacy hash-only paths are also accepted.'},
    updatePrototype: {type: 'boolean', default: true},
    updateSceneTokens: {type: 'boolean', default: false},
    sceneId: {type: 'string', description: 'Scene ID; otherwise uses the currently viewed scene when updating tokens.'}
  }, ['actorId', 'path']),
  definition('upload-map', 'Upload a PNG map from the configured local artwork folder to the fixed ai-maps folder. Uses a readable filename plus a short content hash. Maximum 25 MiB and 8192 pixels per side. Does not assign or resize any scene.',
    {fileName: {type: 'string', description: 'Plain PNG filename in the configured local artwork folder.'}}, ['fileName']),
  definition('get-scene-map', 'Read a scene\'s dimensions, grid and level background paths before assigning a map. Use this to preserve sizing and choose a levelId in multi-level scenes.',
    {sceneId: {type: 'string', description: 'World scene ID.'}}, ['sceneId'], true),
  definition('set-scene-map', 'Assign an uploaded ai-maps PNG as the background of one Foundry 14 scene level. Preserves scene dimensions, grid, background transforms and all tokens. For multi-level scenes, supply levelId from get-scene-map. This tool does not resize scenes or create scenes.', {
    sceneId: {type: 'string', description: 'World scene ID.'},
    levelId: {type: 'string', description: 'Level ID; may be omitted only for a scene with exactly one level.'},
    path: {type: 'string', description: 'Exact ai-maps path returned by upload-map.'}
  }, ['sceneId', 'path'])
];
definitions.push(definition('create-scene-from-map', 'Create a new inactive Foundry 14 scene using an uploaded ai-maps PNG. Set map dimensions and square/gridless grid settings. A stable requestId prevents duplicates on retries. Does not switch scenes, replace scenes or delete anything. Scene deletion is reserved for the user in Foundry.', {
  requestId: {type: 'string', description: 'Stable unique 16–64 character identifier; reuse exactly for retries.'},
  name: {type: 'string', description: 'Unique human-readable scene name.'},
  path: {type: 'string', description: 'Exact ai-maps PNG path returned by upload-map.'},
  width: {type: 'integer', minimum: 1, maximum: 8192, description: 'Scene width in pixels, normally the uploaded map width.'},
  height: {type: 'integer', minimum: 1, maximum: 8192, description: 'Scene height in pixels, normally the uploaded map height.'},
  gridSize: {type: 'integer', minimum: 20, maximum: 1000, default: 100, description: 'Pixels per grid square. Use 25 for the existing town map.'},
  gridDistance: {type: 'number', exclusiveMinimum: 0, maximum: 10000, default: 5},
  gridUnits: {type: 'string', default: 'ft'},
  gridType: {type: 'integer', enum: [0, 1], default: 1, description: '0 gridless, 1 square.'},
  padding: {type: 'number', minimum: 0, maximum: 0.5, multipleOf: 0.05, default: 0.25}
}, ['requestId', 'name', 'path', 'width', 'height']));

async function readBoundedPng(root, name, policy, limits) {
  const maxBytes = limits?.maxBytes ?? policy.MAX_BYTES;
  policy.validateLocalName(name);
  const rootReal = await fs.realpath(root);
  const filePath = path.join(rootReal, name);
  const linkInfo = await fs.lstat(filePath);
  if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) throw new Error('Artwork must be a regular file, not a link or directory.');
  const resolved = await fs.realpath(filePath);
  const relative = path.relative(rootReal, resolved);
  if (relative !== name) throw new Error('Artwork must be directly inside the configured local folder.');
  const file = await fs.open(resolved, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('PNG exceeds the image size limit or is not a regular file.');
    const bytes = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = await file.read(bytes, total, bytes.length - total, total);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    const content = bytes.subarray(0, total);
    policy.validatePng(content, limits);
    return content;
  } finally { await file.close(); }
}

function createPortraitTools(foundryClient, localRoot) {
  const creation = creationTools.createCreationTools(foundryClient);
  const environment = environmentTools.createEnvironmentTools(foundryClient);
  const policyPromise = import(pathToFileURL(path.join(__dirname, 'portrait-policy.mjs')).href);
  return {
    definitions,
    async handle(name, args) {
      const policy = await policyPromise;
      if (environmentTools.definitions.some(d => d.name === name)) return environment.handle(name, args);
      if (creationTools.definitions.some(d => d.name === name)) return creation.handle(name, args);
      if (name === 'portrait-bridge-status') {
        policy.exactKeys(args, []);
        return await foundryClient.query(`${NAMESPACE}.status`, {});
      }
      if (name === 'upload-portrait' || name === 'upload-map') {
        const isMap = name === 'upload-map';
        policy.exactKeys(args, ['fileName']);
        policy.validateLocalName(args.fileName);
        const status = await foundryClient.query(`${NAMESPACE}.status`, {});
        if (!['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0'].includes(status?.version) || (isMap && status.mapFolder !== policy.MAP_FOLDER)) {
          throw new Error('Refresh the Foundry browser tab to load the current AI Image Bridge before uploading.');
        }
        if (status?.folder !== policy.FOLDER || status?.enabled !== true || status?.bridgeWritesEnabled !== true) {
          throw new Error('Enable AI Portrait Bridge and bridge writes in the connected world before uploading.');
        }
        const bytes = await readBoundedPng(localRoot, args.fileName, policy, isMap ? policy.MAP_LIMITS : undefined);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const result = await foundryClient.query(`${NAMESPACE}.${isMap ? 'uploadMap' : 'upload'}`, {base64: bytes.toString('base64'), sha256, fileName: args.fileName});
        const expectedPath = isMap ? policy.mapPath(sha256, args.fileName) : policy.portraitPath(sha256, args.fileName);
        if (result?.success !== true || result?.path !== expectedPath) throw new Error('Foundry did not confirm the expected uploaded image.');
        return {...result, localFileName: args.fileName};
      }
      if (name === 'set-actor-artwork') {
        return await foundryClient.query(`${NAMESPACE}.setArtwork`, policy.validateArtworkArgs(args));
      }
      if (name === 'get-scene-map') return await foundryClient.query(`${NAMESPACE}.getSceneMap`, policy.validateSceneMapArgs(args));
      if (name === 'set-scene-map') return await foundryClient.query(`${NAMESPACE}.setSceneMap`, policy.validateSceneMapArgs(args, true));
      if (name === 'create-scene-from-map') {
        const validated = policy.validateCreateSceneArgs(args);
        const status = await foundryClient.query(`${NAMESPACE}.status`, {});
        if (!['1.3.0', '1.4.0'].includes(status?.version) || status.sceneCreation !== true || status.sceneDeletionAllowed !== false) throw new Error('Refresh the Foundry browser tab to load AI Image Bridge 1.3.0 before creating scenes.');
        return await foundryClient.query(`${NAMESPACE}.createSceneFromMap`, validated);
      }
      throw new Error(`Unknown portrait tool: ${name}`);
    }
  };
}

module.exports = {createPortraitTools, readBoundedPng, definitions};

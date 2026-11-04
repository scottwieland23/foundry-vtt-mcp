import {FOLDER, MAX_BYTES, MAX_EDGE, MAP_FOLDER, MAP_LIMITS, exactKeys, validateHash, portraitPath, mapPath, validatePng,
  decodePayload, validateArtworkArgs, validateSceneMapArgs, validateCreateSceneArgs} from './portrait-policy.mjs';
import {makeCreationHandlers} from './creation-module.mjs';
import {makeEnvironmentHandlers} from './environment-module.mjs';

const ID = 'ai-portrait-bridge';
const BASE = 'foundry-mcp-bridge';

function requireGM() {
  if (!game.user?.isGM) throw new Error('Only a connected Game Master can use the portrait bridge.');
  if (!game.modules.get(ID)?.active || !game.modules.get(BASE)?.active) throw new Error('Both bridge modules must be enabled.');
}

function requireWrites() {
  requireGM();
  if (game.settings.get(BASE, 'enabled') !== true || game.settings.get(BASE, 'allowWriteOperations') !== true) {
    throw new Error('Foundry MCP Bridge writes are disabled.');
  }
  if (game.settings.get(ID, 'enabled') !== true) throw new Error('Portrait uploads are disabled in this world.');
}

function picker() { return foundry.applications.apps.FilePicker.implementation; }

// Serialize writes so two identical requests in this GM client cannot overwrite each other.
let writeQueue = Promise.resolve();
function serialize(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}

async function folderFiles(folder = FOLDER) {
  if (![FOLDER, MAP_FOLDER].includes(folder)) throw new Error('Unsupported asset folder.');
  const root = await picker().browse('data', '');
  if (!Array.isArray(root.dirs)) throw new Error('Could not inspect the Foundry data directory.');
  if (!root.dirs.includes(folder)) {
    try { await picker().createDirectory('data', folder); }
    catch (error) {
      const refreshed = await picker().browse('data', '');
      if (!refreshed.dirs?.includes(folder)) throw error;
    }
  }
  const result = await picker().browse('data', folder);
  if (!Array.isArray(result.files)) throw new Error(`Could not inspect ${folder}.`);
  return result.files;
}

export function uploadPortrait(args) { return uploadImage(args, false); }
export function uploadMap(args) { return uploadImage(args, true); }

async function uploadImage(args, isMap) {
  requireWrites();
  exactKeys(args, ['base64', 'sha256', 'fileName']);
  validateHash(args.sha256);
  const folder = isMap ? MAP_FOLDER : FOLDER;
  const limits = isMap ? MAP_LIMITS : undefined;
  const maxBytes = limits?.maxBytes ?? MAX_BYTES;
  const bytes = decodePayload(args.base64, text => Uint8Array.from(atob(text), c => c.charCodeAt(0)), limits);
  const dimensions = validatePng(bytes, limits);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== args.sha256) throw new Error('Image hash does not match its contents.');
  const path = isMap ? mapPath(digest, args.fileName) : portraitPath(digest, args.fileName);
  const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
  try {
    if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) throw new Error('Image dimensions do not match PNG header.');
  } finally { bitmap.close(); }
  return serialize(async () => {
    requireWrites();
    const files = await folderFiles(folder);
    if (files.includes(path)) {
      const response = await fetch(new URL(path, document.baseURI), {cache: 'no-store', credentials: 'same-origin'});
      if (!response.ok) throw new Error('Could not verify existing portrait contents.');
      const reader = response.body.getReader();
      const parts = []; let length = 0;
      try {
        for (;;) {
          const {value, done} = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maxBytes) { await reader.cancel(); throw new Error('Existing image exceeds the image size limit.'); }
          parts.push(value);
        }
      } finally { reader.releaseLock(); }
      const content = new Uint8Array(length); let offset = 0;
      for (const part of parts) { content.set(part, offset); offset += part.byteLength; }
      const existingDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      if (existingDigest !== digest) throw new Error('Portrait filename collision: choose a different local image filename. Nothing was overwritten.');
      return {success: true, path, reused: true, ...dimensions};
    }
    const file = new File([bytes], path.slice(folder.length + 1), {type: 'image/png'});
    const result = await picker().upload('data', folder, file, {}, {notify: false});
    if (result?.path !== path) throw new Error('Foundry did not confirm the expected portrait path. No artwork was assigned.');
    ui.notifications.info(`Image uploaded to ${folder}.`);
    return {success: true, path, reused: false, ...dimensions};
  });
}

function resolveScene(sceneId) {
  const scene = game.scenes.get(sceneId);
  if (!scene) throw new Error('World scene not found.');
  return scene;
}

function sceneLayout(scene) {
  return {width: scene.width, height: scene.height, padding: scene.padding, grid: structuredClone(scene._source.grid)};
}

export async function getSceneMap(raw) {
  requireGM();
  const args = validateSceneMapArgs(raw);
  const scene = resolveScene(args.sceneId);
  return {sceneId: scene.id, name: scene.name, ...sceneLayout(scene), levels: Array.from(scene.levels).map(level =>
    ({id: level.id, name: level.name, background: structuredClone(level._source.background)}))};
}

export async function setSceneMap(raw) {
  requireWrites();
  const args = validateSceneMapArgs(raw, true);
  return serialize(async () => {
    requireWrites();
    const files = await folderFiles(MAP_FOLDER);
    if (!files.includes(args.path)) throw new Error('Upload this image to ai-maps before assigning it.');
    const scene = resolveScene(args.sceneId);
    const levels = Array.from(scene.levels);
    const level = args.levelId ? scene.levels.get(args.levelId) : (levels.length === 1 ? levels[0] : null);
    if (!level) throw new Error('Choose a levelId from get-scene-map for this scene.');
    const before = sceneLayout(scene);
    const previousBackground = structuredClone(level._source.background);
    await scene.updateEmbeddedDocuments('Level', [{_id: level.id, 'background.src': args.path}]);
    const saved = scene.levels.get(level.id);
    if (saved?.background?.src !== args.path) throw new Error('Foundry did not save the requested level background.');
    const after = sceneLayout(scene);
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Background was assigned but scene dimensions or grid unexpectedly changed; inspect the scene before proceeding.');
    return {success: true, sceneId: scene.id, levelId: level.id, path: args.path,
      layoutPreserved: true, ...after, previousBackground};
  });
}

export async function createSceneFromMap(raw) {
  requireWrites();
  const args = validateCreateSceneArgs(raw);
  return serialize(async () => {
    requireWrites();
    let scene = Array.from(game.scenes).find(s => s.flags?.[ID]?.creation?.requestId === args.requestId);
    const reused = !!scene;
    if (scene && JSON.stringify(validateCreateSceneArgs(scene.flags[ID].creation)) !== JSON.stringify(args)) throw new Error('requestId already belongs to different scene settings. Nothing was changed.');
    if (!scene) {
      if (Array.from(game.scenes).some(s => s.name.trim().toLowerCase() === args.name.toLowerCase())) throw new Error('A scene with this name already exists. Choose a unique name or inspect the existing scene.');
      if (!(await folderFiles(MAP_FOLDER)).includes(args.path)) throw new Error('Upload this image to ai-maps before creating a scene.');
      scene = await CONFIG.Scene.documentClass.create({name: args.name, width: args.width, height: args.height, padding: args.padding,
        active: false, navigation: false, ownership: {default: 0},
        grid: {type: args.gridType, size: args.gridSize, distance: args.gridDistance, units: args.gridUnits},
        initialLevel: 'defaultLevel0000', levels: [{_id: 'defaultLevel0000', name: 'Ground', background: {src: args.path}}],
        flags: {[ID]: {creation: args}}}, {renderSheet: false});
      if (!scene) throw new Error('Scene creation was cancelled. Retry with the same requestId.');
    }
    // No delete/rollback operation: even a partially created scene is retained for the user.
    const result = await getSceneMap({sceneId: scene.id});
    if (result.levels.length !== 1 || result.levels[0].background.src !== args.path || result.width !== args.width || result.height !== args.height ||
        result.padding !== args.padding || result.grid.size !== args.gridSize || result.grid.type !== args.gridType ||
        result.grid.distance !== args.gridDistance || result.grid.units !== args.gridUnits) {
      throw new Error(`Scene ${scene.id} exists but its saved settings need inspection. Retry using the same requestId; do not create another scene. No scene was deleted.`);
    }
    return {success: true, reused, requestId: args.requestId, ...result};
  });
}

export async function setArtwork(raw) {
  requireWrites();
  const args = validateArtworkArgs(raw);
  return serialize(async () => {
    requireWrites();
    const files = await folderFiles();
    if (!files.includes(args.path)) throw new Error('Upload this image to ai-portraits before assigning it.');
    const actor = game.actors.get(args.actorId);
    if (!actor) throw new Error('World actor not found.');
    let scene;
    if (args.updateSceneTokens) {
      scene = args.sceneId ? game.scenes.get(args.sceneId) : canvas.scene;
      if (!scene) throw new Error('Select a scene or supply its ID.');
    }
    const tokens = scene ? Array.from(scene.tokens).filter(t => t.actorId === actor.id) : [];
    const previous = {
      portrait: actor.img,
      prototype: actor.prototypeToken?.texture?.src,
      prototypeScale: {x: actor.prototypeToken?.texture?.scaleX, y: actor.prototypeToken?.texture?.scaleY},
      tokens: tokens.map(t => ({id: t.id, path: t.texture.src, scaleX: t.texture.scaleX, scaleY: t.texture.scaleY}))
    };
    const changes = {img: args.path};
    if (args.updatePrototype) {
      changes['prototypeToken.texture.src'] = args.path;
      changes['prototypeToken.texture.scaleX'] = 1;
      changes['prototypeToken.texture.scaleY'] = 1;
    }
    await actor.update(changes);
    try {
      if (tokens.length) await scene.updateEmbeddedDocuments('Token', tokens.map(t => ({_id: t.id, 'texture.src': args.path, 'texture.scaleX': 1, 'texture.scaleY': 1})));
    } catch (error) {
      throw new Error(`Actor artwork was saved, but scene-token updates failed: ${error.message}. Retry the same request. Actor ID: ${actor.id}`);
    }
    const verified = actor.img === args.path && (!args.updatePrototype ||
      (actor.prototypeToken.texture.src === args.path && actor.prototypeToken.texture.scaleX === 1 && actor.prototypeToken.texture.scaleY === 1)) &&
      tokens.every(t => {const saved = scene.tokens.get(t.id)?.texture; return saved?.src === args.path && saved.scaleX === 1 && saved.scaleY === 1;});
    if (!verified) throw new Error('Artwork update returned without the expected saved paths; inspect the actor and retry.');
    return {success: true, actorId: actor.id, path: args.path, prototypeUpdated: args.updatePrototype,
      sceneId: scene?.id ?? null, updatedTokenIds: tokens.map(t => t.id), artworkScale: 1, previous};
  });
}

Hooks.once('init', () => {
  game.settings.register(ID, 'enabled', {
    name: 'Enable AI Creation Bridge tools',
    hint: 'Allow dedicated-folder images, character/scene creation, walls, lights and vision tools. Scene deletion is never available.',
    scope: 'world', config: true, type: Boolean, default: true
  });
});

Hooks.once('ready', () => {
  if (!game.user?.isGM || !game.modules.get(BASE)?.active) return;
  CONFIG.queries[`${ID}.status`] = async () => {
    requireGM();
    return {version: '1.5.0', sceneCreation: true, sceneDeletionAllowed: false, pcCreation: true, environmentTools: true,
      plutonium: {active: !!game.modules.get('plutonium')?.active, version: game.modules.get('plutonium')?.version ?? null, searchReady: !!globalThis.DataLoader?.pCacheAndGet},
      folder: FOLDER, maxBytes: MAX_BYTES, maxEdge: MAX_EDGE, artworkScale: 1, readableFilenames: true,
      mapFolder: MAP_FOLDER, mapMaxBytes: MAP_LIMITS.maxBytes, mapMaxEdge: MAP_LIMITS.maxEdge,
      formats: ['image/png'], enabled: game.settings.get(ID, 'enabled'),
      bridgeWritesEnabled: game.settings.get(BASE, 'allowWriteOperations') === true};
  };
  CONFIG.queries[`${ID}.upload`] = uploadPortrait;
  CONFIG.queries[`${ID}.setArtwork`] = setArtwork;
  CONFIG.queries[`${ID}.uploadMap`] = uploadMap;
  CONFIG.queries[`${ID}.getSceneMap`] = getSceneMap;
  CONFIG.queries[`${ID}.setSceneMap`] = setSceneMap;
  CONFIG.queries[`${ID}.createSceneFromMap`] = createSceneFromMap;
  const creation = makeCreationHandlers({requireGM, requireWrites, serialize});
  CONFIG.queries[`${ID}.searchPlutonium`] = creation.search;
  CONFIG.queries[`${ID}.getPlutoniumEntry`] = creation.getEntry;
  CONFIG.queries[`${ID}.createPlayerCharacter`] = creation.createPC;
  const environment = makeEnvironmentHandlers({requireGM, requireWrites, serialize});
  CONFIG.queries[`${ID}.readEnvironment`] = environment.read;
  CONFIG.queries[`${ID}.manageWalls`] = environment.walls;
  CONFIG.queries[`${ID}.manageLights`] = environment.lights;
  CONFIG.queries[`${ID}.setVisibility`] = environment.visibility;
  CONFIG.queries[`${ID}.setTokenVision`] = environment.tokenVision;
  CONFIG.queries[`${ID}.resetFog`] = environment.resetFog;
  console.info(`${ID}: ready; upload destination is fixed to ${FOLDER}.`);
});

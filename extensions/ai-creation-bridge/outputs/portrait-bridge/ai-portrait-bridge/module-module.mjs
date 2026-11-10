import {definitions, validate} from './module-schemas.mjs';

const bridgeId = 'ai-portrait-bridge';
const tileModule = 'monks-active-tiles';
const libraries = {
  jb2a: {module: 'JB2A_DnD5e', kind: 'visual'},
  'ggg-vfx': {module: 'ggg', kind: 'visual'},
  'ggg-sfx': {module: 'ggg', kind: 'sound'},
  soundfxlibrary: {module: 'soundfxlibrary', kind: 'sound'}
};
const soundFolders = ['Combat/Loops', 'Combat/Single', 'Creatures/Animals', 'Creatures/Monsters',
  'Misc/Loops', 'Misc/Single', 'Nature/Loops', 'Nature/Single', 'Tavern/Loops', 'Tavern/Single',
  'Town/Loops', 'Town/Single'];
const collections = {token:'tokens', tile:'tiles', wall:'walls', light:'lights', drawing:'drawings', region:'regions'};

function need(args, ...keys) {
  for (const key of keys) if (args[key] === undefined) throw Error('Missing field: ' + key);
}

function moduleActive(id) {
  const module = game.modules.get(id);
  if (!module?.active) throw Error('Enable ' + id + ' in the connected world.');
  return module;
}

function method(object, name, label) {
  if (typeof object?.[name] !== 'function') throw Error(label + ' API is unavailable in this GM client.');
  return object[name].bind(object);
}

function sceneFor(id, viewed = false) {
  const scene = game.scenes.get(id);
  if (!scene) throw Error('Scene was not found in the connected world.');
  if (viewed && (!globalThis.canvas?.ready || canvas.scene?.id !== scene.id)) {
    throw Error('Open the selected scene in the connected GM tab first.');
  }
  return scene;
}

function documentFor(scene, kind, id) {
  const document = scene[collections[kind]]?.get(id);
  if (!document) throw Error('Selected ' + kind + ' does not exist in this scene: ' + id);
  return document;
}

function pointInside(scene, x, y, width = 0, height = 0) {
  const dimensions = scene.dimensions ?? scene.getDimensions();
  if (x < 0 || y < 0 || x + width > dimensions.width || y + height > dimensions.height) {
    throw Error('Coordinates must stay inside the selected scene canvas.');
  }
}

function pageOf(entries, args, searchable = v => String(v)) {
  const needle = (args.query ?? '').trim().toLowerCase();
  const filtered = entries.filter(e => searchable(e).toLowerCase().includes(needle));
  const offset = args.offset ?? 0, limit = args.limit ?? 10;
  return {total:filtered.length, entries:filtered.slice(offset, offset + limit),
    nextOffset:offset + limit < filtered.length ? offset + limit : null};
}

function itemPileApi() {
  moduleActive('item-piles');
  if (game.system.id === 'dnd5e') moduleActive('itempilesdnd5e');
  return game.itempiles?.API;
}

function mediaPath(path, library) {
  if (typeof path !== 'string' || path.length > 400) return false;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  const info = libraries[library];
  if (!decoded.startsWith('modules/' + info.module + '/') || decoded.includes('\\') ||
      /[%?#:\u0000-\u001f]/.test(decoded) || decoded.split('/').some(s => s === '..' || s === '.')) return false;
  return info.kind === 'sound' ? /\.(ogg|wav|mp3|flac|m4a|opus)$/i.test(decoded) : /\.(webm|mp4|png|webp)$/i.test(decoded);
}

function sequenceDatabase() {
  moduleActive('sequencer');
  return globalThis.Sequencer?.Database;
}

function validateDatabaseMedia(id, library) {
  if (!id.startsWith(library + '.') || !/^[a-z0-9_.\[\]-]{1,400}$/i.test(id) || id.includes('..')) {
    throw Error('Use a media ID from the selected installed library.');
  }
  const db = sequenceDatabase();
  const files = method(db, 'getAllFileEntries', 'Sequencer database')(id);
  if (!files?.length || !files.every(file => mediaPath(file, library))) {
    throw Error('The selected entry contains unsupported media paths.');
  }
  return id;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function makeModuleHandlers({requireGM, requireWrites, serialize}) {
  let libraryFiles;
  let routeRunning = false;

  async function soundFxFiles() {
    moduleActive('soundfxlibrary');
    if (!libraryFiles) {
      libraryFiles = (async () => {
        const picker = foundry.applications.apps.FilePicker.implementation;
        const files = [];
        for (const folder of soundFolders) {
          const result = await picker.browse('data', 'modules/soundfxlibrary/' + folder);
          files.push(...(result.files ?? []).filter(file => mediaPath(file, 'soundfxlibrary')));
        }
        return [...new Set(files)].sort();
      })().catch(error => { libraryFiles = undefined; throw error; });
    }
    return libraryFiles;
  }

  async function describe() {
    const db = globalThis.Sequencer?.Database;
    const modules = [...game.modules.values()].filter(module => module.active).slice(0, 100)
      .map(module => ({id:module.id, title:module.title, version:module.version,
        dependencies:[...(module.relationships?.requires ?? [])].filter(dependency => dependency.type === 'module')
          .map(dependency => ({id:dependency.id, active:!!game.modules.get(dependency.id)?.active}))}));
    const ready = {
      itemPiles: typeof game.itempiles?.API?.turnTokensIntoItemPiles === 'function' &&
        (game.system.id !== 'dnd5e' || !!game.modules.get('itempilesdnd5e')?.active),
      activeTiles: typeof game.MonksActiveTiles?.triggerTile === 'function',
      tagger: typeof globalThis.Tagger?.addTags === 'function',
      rideable: typeof game.Rideable?.Mount === 'function',
      sequencer: typeof globalThis.Sequence === 'function' && typeof db?.getPathsUnder === 'function',
      jb2a: !!db?.entryExists?.('jb2a'),
      gggSounds: !!db?.entryExists?.('ggg-sfx'),
      gggVisuals: !!db?.entryExists?.('ggg-vfx'),
      soundFxLibrary: !!game.modules.get('soundfxlibrary')?.active,
      fxmaster: typeof game.modules.get('fxmaster')?.api?.presets?.play === 'function',
      animater: typeof game.modules.get('animater')?.api?.recipes === 'function',
      tokenizer: typeof game.modules.get('vtta-tokenizer')?.api?.tokenizeActor === 'function',
      tokenBar: typeof game.MonksTokenBar?.requestRoll === 'function',
      routingLib: typeof globalThis.routinglib?.calculatePath === 'function',
      diceSoNice: !!game.dice3d
    };
    return {worldId:game.world.id, system:game.system.id, activeModules:modules, ready,
      tools:definitions.map(tool => tool.name),
      nativeUiModules:['dice-calculator','dice-so-nice','healthEstimate','token-action-hud-core','token-action-hud-dnd5e'],
      supportModules:['socketlib','lib-wrapper','itempilesdnd5e']};
  }

  async function itemPile(args) {
    const scene = sceneFor(args.sceneId);
    const token = documentFor(scene, 'token', args.tokenId);
    const api = itemPileApi();
    const valid = method(api, 'isValidItemPile', 'Item Piles');
    const inspect = () => {
      const current = scene.tokens.get(token.id);
      const actor = current.actor;
      const active = valid(current);
      return {sceneId:scene.id, tokenId:token.id, actorId:actor?.id, active,
        type:active ? ['Merchant','Container','Vault','Banker','Auctioneer'].find(kind =>
          api['isItemPile' + kind]?.(current))?.toLowerCase() ?? 'loot' : null,
        inventoryCount:actor?.items?.size ?? 0,
        items:[...(actor?.items?.values() ?? [])].slice(0, 20).map(item => ({
          id:item.id, name:item.name, quantity:item.system?.quantity, price:item.system?.price
        }))};
    };
    if (args.mode === 'inspect') return inspect();
    if (token.actorLink || !token.actor || token.actor.type !== 'npc' || token.actor.hasPlayerOwner) {
      throw Error('Select an unlinked NPC token reserved for a shop or loot container.');
    }
    if (args.mode !== 'merchant' && (args.buyMultiplier !== undefined || args.sellMultiplier !== undefined)) {
      throw Error('Price multipliers apply to merchants.');
    }
    if (args.mode !== 'container' && (args.closed !== undefined || args.locked !== undefined)) {
      throw Error('Closed and locked options apply to containers.');
    }
    const before = inspect();
    if (before.active && before.type !== args.mode) throw Error('The selected token is already a different kind of Item Pile.');
    const pileSettings = {enabled:true, type:args.mode === 'loot' ? 'pile' : args.mode, deleteWhenEmpty:false};
    if (args.mode === 'container') {
      if (!before.active || args.closed !== undefined) pileSettings.closed = args.closed ?? true;
      if (args.locked !== undefined) pileSettings.locked = args.locked;
    }
    if (args.buyMultiplier !== undefined) pileSettings.buyPriceModifier = args.buyMultiplier;
    if (args.sellMultiplier !== undefined) pileSettings.sellPriceModifier = args.sellMultiplier;
    if (before.active) await method(api, 'updateItemPile', 'Item Piles')(token, pileSettings);
    else await method(api, 'turnTokensIntoItemPiles', 'Item Piles')([token], {pileSettings});
    const result = inspect();
    if (!result.active || result.type !== args.mode) throw Error('Item Piles did not confirm the requested configuration.');
    return {...result, success:true};
  }

  async function activeTile(args) {
    moduleActive(tileModule);
    if (typeof game.MonksActiveTiles?.triggerTile !== 'function') throw Error('Monk’s Active Tiles is still initializing.');
    const scene = sceneFor(args.sceneId);
    const summary = tile => {
      const own = tile.getFlag(bridgeId, 'trigger');
      const flags = tile.flags?.[tileModule] ?? {};
      return {id:tile.id, label:own?.label, x:tile.x, y:tile.y, width:tile.width, height:tile.height,
        active:flags.active === true, trigger:flags.trigger, targets:own?.targetTokenIds};
    };
    if (args.action === 'inspect') {
      if (args.tileId) {
        const tile = documentFor(scene, 'tile', args.tileId);
        if (!tile.getFlag(bridgeId, 'trigger')) throw Error('Select a bridge-created trigger.');
        return {sceneId:scene.id, entries:[summary(tile)]};
      }
      return {sceneId:scene.id, entries:[...scene.tiles.values()].filter(t => t.getFlag(bridgeId, 'trigger')).slice(0, 25).map(summary)};
    }
    if (args.action === 'set-enabled') {
      need(args, 'tileId', 'enabled');
      const tile = documentFor(scene, 'tile', args.tileId);
      if (!tile.getFlag(bridgeId, 'trigger')) throw Error('The bridge can enable or disable only its own triggers.');
      await tile.update({['flags.' + tileModule + '.active']:args.enabled});
      return {success:true, sceneId:scene.id, tile:summary(scene.tiles.get(tile.id))};
    }
    need(args, 'requestId','label','x','y','width','height','trigger','visibility','targetTokenIds');
    pointInside(scene, args.x, args.y, args.width, args.height);
    const targets = args.targetTokenIds.map(id => documentFor(scene, 'token', id));
    const level = args.levelId ? scene.levels.get(args.levelId) : scene.levels.size === 1 ? scene.levels.values().next().value : null;
    if (!level) throw Error('Choose a valid scene level for the tile.');
    const id = (await digest(bridgeId + ':tile:' + scene.id + ':' + args.requestId)).slice(0, 16);
    const signature = await digest(JSON.stringify(Object.keys(args).sort().map(key => [key,args[key]])));
    const existing = scene.tiles.get(id);
    if (existing) {
      if (existing.getFlag(bridgeId, 'trigger')?.signature !== signature) throw Error('Request ID already belongs to a different tile.');
      return {success:true, reused:true, sceneId:scene.id, tile:summary(existing)};
    }
    const actions = targets.map((target, i) => ({id:id.slice(0, 12) + String(i).padStart(4, '0'),
      action:'showhide', data:{entity:{id:target.uuid, name:target.name}, collection:'tokens', hidden:args.visibility, fade:0}}));
    const [tile] = await scene.createEmbeddedDocuments('Tile', [{
      _id:id, x:args.x, y:args.y, width:args.width, height:args.height, levels:[level.id], hidden:false,
      texture:{src:'icons/svg/aura.svg'}, alpha:0,
      flags:{[bridgeId]:{trigger:{signature,label:args.label,targetTokenIds:args.targetTokenIds}},
        [tileModule]:{active:args.enabled ?? true, trigger:[args.trigger], restriction:'all', controlled:'all',
          chance:100, record:args.oncePerToken ?? true, pertoken:args.oncePerToken ?? true, actions}}
    }], {keepId:true});
    if (!tile || tile.id !== id || tile.flags?.[tileModule]?.actions?.length !== targets.length) throw Error('The trigger did not save as requested.');
    return {success:true, reused:false, sceneId:scene.id, tile:summary(tile)};
  }

  async function tags(args) {
    moduleActive('tagger');
    const scene = sceneFor(args.sceneId);
    const docs = args.ids.map(id => documentFor(scene, args.documentType, id));
    const api = globalThis.Tagger;
    if (args.action !== 'get') {
      need(args, 'tags');
      await method(api, args.action === 'add' ? 'addTags' : 'removeTags', 'Tagger')(docs, args.tags);
    }
    const read = method(api, 'getTags', 'Tagger');
    return {sceneId:scene.id, entries:docs.map(d => ({id:d.id, tags:read(d).slice(0, 30)}))};
  }

  async function ride(args) {
    const module = moduleActive('Rideable');
    const scene = sceneFor(args.sceneId, true);
    const riders = args.riderIds.map(id => documentFor(scene, 'token', id));
    const flags = module.api?.RideableFlags;
    const readRiders = method(flags, 'RiderTokenIDs', 'Rideable');
    const isRider = method(flags, 'isRider', 'Rideable');
    const mount = args.mountId ? documentFor(scene, 'token', args.mountId) : null;
    const summary = () => ({sceneId:scene.id, mountId:mount?.id, mountedIds:mount ? readRiders(mount).slice(0, 20) : [],
      riders:riders.map(r => ({id:r.id, mounted:isRider(r)}))});
    if (args.action === 'inspect') return summary();
    if (args.action === 'mount') {
      if (!mount || riders.some(r => r.id === mount.id)) throw Error('Choose a separate mount token in the same scene.');
      const existing = readRiders(mount);
      if (isRider(mount) || riders.some(r => readRiders(r).length || isRider(r) && !existing.includes(r.id))) {
        throw Error('Dismount the selected tokens before creating a new riding relationship.');
      }
      const pending = riders.filter(r => !existing.includes(r.id));
      if (pending.length) await method(game.Rideable, 'Mount', 'Rideable')(pending, mount, {});
    } else if (riders.some(isRider)) await method(game.Rideable, 'UnMount', 'Rideable')(riders);
    const confirmed = () => args.action === 'mount' ? riders.every(r => readRiders(mount).includes(r.id)) : riders.every(r => !isRider(r));
    for (let i = 0; i < 12 && !confirmed(); i++) await delay(100);
    return {...summary(), confirmed:confirmed()};
  }

  async function searchMedia(args) {
    moduleActive(libraries[args.library].module);
    const paths = args.library === 'soundfxlibrary' ? await soundFxFiles() :
      method(sequenceDatabase(), 'getPathsUnder', 'Sequencer database')(args.library, {fullyQualified:true, ranges:true});
    if (!Array.isArray(paths)) throw Error('The selected media library is still initializing.');
    return {library:args.library, kind:libraries[args.library].kind,
      ...pageOf(paths.filter(p => typeof p === 'string' && p.length <= 400), args)};
  }

  async function playMedia(args) {
    const scene = sceneFor(args.sceneId, true);
    moduleActive(libraries[args.library].module);
    sequenceDatabase();
    const kind = libraries[args.library].kind;
    const sequence = new globalThis.Sequence();
    if (args.library === 'soundfxlibrary') {
      if (!mediaPath(args.assetId, args.library) || !(await soundFxFiles()).includes(args.assetId)) {
        throw Error('Use an installed SoundFx Library ID from search-module-media.');
      }
    } else validateDatabaseMedia(args.assetId, args.library);
    if (kind === 'sound') {
      sequence.sound().file(args.assetId).volume(args.volume ?? 0.25).duration(args.durationMs ?? 6000);
    } else {
      let point;
      if (args.tokenId) {
        const token = documentFor(scene, 'token', args.tokenId);
        if (!token.object) throw Error('The token must be rendered on the viewed scene.');
        point = token.object;
      } else {
        need(args, 'x','y');
        pointInside(scene,args.x,args.y);
        point = {x:args.x,y:args.y};
      }
      sequence.effect().file(args.assetId).atLocation(point).scale(args.scale ?? 1)
        .opacity(args.opacity ?? 1).duration(args.durationMs ?? 3000);
    }
    await sequence.play();
    return {success:true, sceneId:scene.id, library:args.library, assetId:args.assetId};
  }

  async function fx(args) {
    const api = moduleActive('fxmaster').api?.presets;
    const topDown = args.topDown ?? (args.action === 'apply' ? false : null);
    const presets = method(api, 'listValid', 'FXMaster')({topDown});
    if (args.action === 'list') return pageOf(presets,args);
    need(args,'sceneId','preset');
    const scene = sceneFor(args.sceneId);
    if (!presets.includes(args.preset)) throw Error('Use a preset from the installed FXMaster list.');
    const options = {scene, topDown:args.topDown ?? false, silent:true};
    const changed = await method(api,args.action === 'apply' ? 'play' : 'stop','FXMaster')(args.preset,options);
    return {success:changed === true, sceneId:scene.id, preset:args.preset, action:args.action};
  }

  async function animater(args) {
    const api = moduleActive('animater').api;
    const recipes = method(api,'recipes','Animater')();
    if (args.action === 'list') return pageOf(recipes.map(recipe => ({id:recipe.id,name:recipe.name,
      stages:recipe.stages?.map(stage => stage.kind).slice(0, 10)})), args, r => r.id + ' ' + r.name);
    need(args,'sceneId','recipeId','sourceTokenId');
    const scene = sceneFor(args.sceneId,true);
    const recipe = recipes.find(r => r.id === args.recipeId);
    if (!recipe || !recipe.stages?.length || recipe.stages.length > 8) throw Error('Choose an installed recipe with up to eight visual stages.');
    const allowed = new Set(['cast','travel','impact','template']);
    const stages = recipe.stages.map((stage, index) => {
      if (!allowed.has(stage.kind)) throw Error('This recipe includes stages outside the bridge’s visual playback scope.');
      const assets = (stage.assets ?? []).filter(id => typeof id === 'string' && /^(jb2a|ggg-vfx)\./.test(id)).slice(0, 6);
      const installed = assets.filter(id => {
        try { validateDatabaseMedia(id, id.split('.')[0]); return true; } catch { return false; }
      });
      if (!installed.length) throw Error('A visual recipe stage has no verified installed media.');
      const bound = (value, minimum, maximum, fallback) => Number.isFinite(value) ? Math.max(minimum, Math.min(maximum,value)) : fallback;
      return {stageId:'bridge-' + index, kind:stage.kind, assets:installed, delay:bound(stage.delay,0,3000,0),
        duration:bound(stage.duration,100,5000,1000), scale:bound(stage.scale,0.1,3,1),
        opacity:bound(stage.opacity,0,1,1), oneShot:true, persist:false};
    });
    const source = documentFor(scene,'token',args.sourceTokenId).object;
    const targets = (args.targetTokenIds ?? []).map(id => documentFor(scene,'token',id).object);
    if (!source || targets.some(t => !t)) throw Error('The selected tokens must be rendered in the GM tab.');
    await method(api,'play','Animater')({id:'creation-bridge-preview',name:recipe.name,trigger:'manual',stages},{source,targets});
    return {success:true, sceneId:scene.id, recipeId:recipe.id};
  }

  async function tokenizer(args) {
    const api = moduleActive('vtta-tokenizer').api;
    const actor = game.actors.get(args.actorId);
    if (!actor) throw Error('Select an existing world actor.');
    await method(api,'tokenizeActor','Tokenizer')(actor);
    return {opened:true, actorId:actor.id, actorName:actor.name};
  }

  async function tokenBar(args) {
    moduleActive('monks-tokenbar');
    const scene = sceneFor(args.sceneId,true);
    const docs = args.tokenIds.map(id => documentFor(scene,'token',id));
    const tokens = docs.map(doc => doc.object);
    if (tokens.some(t => !t)) throw Error('The selected tokens must be rendered in the GM tab.');
    const api = game.MonksTokenBar;
    if (args.action === 'movement') {
      need(args,'movement');
      await method(api,'changeMovement','Monk’s TokenBar')(args.movement,tokens);
      return {requested:true, sceneId:scene.id, tokenIds:args.tokenIds, movement:args.movement};
    }
    need(args,'rollType','ability','visibility');
    const dialog = await method(api,'requestRoll','Monk’s TokenBar')(tokens,{
      request:args.rollType + ':' + args.ability, dc:args.dc, rollmode:args.visibility, silent:false, fastForward:false
    });
    if (!dialog) throw Error('Monk’s TokenBar did not open the roll dialog.');
    return {opened:true, sceneId:scene.id, tokenIds:args.tokenIds};
  }

  async function route(args) {
    moduleActive('routinglib');
    const scene = sceneFor(args.sceneId,true);
    const token = documentFor(scene,'token',args.tokenId).object;
    if (!token) throw Error('The selected token must be rendered in the GM tab.');
    pointInside(scene,args.x,args.y);
    if (routeRunning) throw Error('Wait for the current route calculation to finish.');
    const grid = canvas.grid;
    const coordinate = point => {
      if (grid.isGridless) return {x:point.x,y:point.y};
      const {i,j} = grid.getOffset(point);
      return {x:j,y:i};
    };
    const api = globalThis.routinglib;
    const calculate = method(api,'calculatePath','RoutingLib');
    const cancel = method(api,'cancelPathfinding','RoutingLib');
    let timer;
    routeRunning = true;
    try {
      const job = calculate(coordinate(token.center),coordinate({x:args.x,y:args.y}),{token,maxDistance:args.maxDistance});
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => {
          resolve({timedOut:true});
          cancel(job);
        }, 5000);
      });
      const result = await Promise.race([job,timeout]);
      return {sceneId:scene.id, found:!!result?.path, timedOut:result?.timedOut ?? false, cost:result?.cost,
        coordinates:grid.isGridless ? 'pixels' : 'grid cells', path:result?.path?.slice(0, 100) ?? [],
        truncated:(result?.path?.length ?? 0) > 100};
    } finally {clearTimeout(timer);routeRunning = false;}
  }

  const handlers = {
    'get-module-capabilities':describe, 'configure-item-pile':itemPile, 'manage-active-tile':activeTile,
    'manage-scene-tags':tags, 'manage-token-riding':ride, 'search-module-media':searchMedia,
    'play-module-media':playMedia, 'manage-fxmaster-preset':fx, 'use-animater-recipe':animater,
    'open-tokenizer':tokenizer, 'use-monks-tokenbar':tokenBar, 'estimate-routinglib-path':route
  };
  const readOnly = (name,args) => ['get-module-capabilities','search-module-media','estimate-routinglib-path'].includes(name) ||
    name === 'configure-item-pile' && args.mode === 'inspect' ||
    ['manage-active-tile','manage-token-riding'].includes(name) && args.action === 'inspect' ||
    name === 'manage-scene-tags' && args.action === 'get' ||
    ['manage-fxmaster-preset','use-animater-recipe'].includes(name) && args.action === 'list';
  return Object.fromEntries(Object.entries(handlers).map(([name,run]) => [name, raw => {
    requireGM();
    const args = validate(name,raw);
    if (readOnly(name,args)) return run(args);
    requireWrites();
    return serialize(() => run(args));
  }]));
}

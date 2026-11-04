import {SENSES, DIRECTIONS, DOORS, DOOR_STATES, FOG_MODES, readArgs, manageArgs, visibilityArgs, tokenVisionArgs, resetArgs} from './environment-policy.mjs';
const ID = 'ai-portrait-bridge';
const clone = value => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, clone(value[k])]));
const inverse = (map, value) => Object.keys(map).find(k => map[k] === value) ?? value;
function sceneFor(id) { const scene = game.scenes.get(id); if (!scene) throw new Error('World scene not found.'); return scene; }
function source(doc) { return doc._source ?? doc.toObject(); }
function wallSummary(doc) {
  const s = source(doc); return {id: doc.id, label: s.flags?.[ID]?.environment?.label ?? 'Wall', coordinates: clone(s.c), levelIds: clone(s.levels ?? []),
    blocksMovement: s.move !== 0, sight: inverse(SENSES, s.sight), light: inverse(SENSES, s.light), sound: inverse(SENSES, s.sound),
    direction: inverse(DIRECTIONS, s.dir), door: inverse(DOORS, s.door), doorState: inverse(DOOR_STATES, s.ds)};
}
function lightSummary(doc) { const s = source(doc); return {id: doc.id, ...pick(s, ['name','x','y','levels','elevation','rotation','walls','vision','hidden']), config: pick(s.config, ['bright','dim','color','alpha','angle','negative','luminosity','animation'])}; }
function tokenSummary(doc) { const s = source(doc); return {id: doc.id, ...pick(s, ['name','actorId','level','x','y','hidden','sight','detectionModes'])}; }
function settings(scene) { const s = source(scene); return {tokenVision: s.tokenVision, globalLight: !!s.environment?.globalLight?.enabled, darkness: s.environment?.darknessLevel ?? 0,
  fogMode: inverse(FOG_MODES, s.fog?.mode), fogResetTimestamp: s.fog?.reset ?? null}; }
function dimensions(scene) {
  const d = scene.dimensions ?? scene.getDimensions();
  return pick(d, ['width','height','sceneX','sceneY','sceneWidth','sceneHeight','size','distance']);
}
function checkPoint(scene, x, y) {
  const d = dimensions(scene);
  if (x < 0 || y < 0 || x > d.width || y > d.height) throw new Error(`Coordinates must stay inside this scene's padded canvas (0–${d.width}, 0–${d.height}).`);
}
function levels(scene, value, creating) {
  if (value !== undefined) { for (const id of value) if (!scene.levels.get(id)) throw new Error('A selected level does not exist in this scene.'); return value; }
  if (!creating) return undefined;
  const list = Array.from(scene.levels);
  if (list.length !== 1) throw new Error('Specify levelIds when creating walls or lights in a multi-level scene.');
  return [list[0].id];
}
function wallData(scene, entry, creating, existing) {
  const data = creating ? {c: entry.coordinates, move: 20, sight: 20, light: 20, sound: 20, dir: 0, door: 0, ds: 0} : {};
  if (entry.coordinates) { const [x1,y1,x2,y2] = entry.coordinates; checkPoint(scene,x1,y1); checkPoint(scene,x2,y2); data.c = entry.coordinates; }
  const levelIds = levels(scene, entry.levelIds, creating); if (levelIds) data.levels = levelIds;
  if (entry.blocksMovement !== undefined) data.move = entry.blocksMovement ? 20 : 0;
  for (const key of ['sight','light','sound']) if (entry[key] !== undefined) data[key] = SENSES[entry[key]];
  if (entry.direction !== undefined) data.dir = DIRECTIONS[entry.direction];
  if (entry.door !== undefined) { data.door = DOORS[entry.door]; if (!data.door) data.ds = 0; }
  if (entry.doorState !== undefined) {
    if (!(data.door ?? source(existing ?? {} ).door)) throw new Error('Cannot set door state on a non-door wall.');
    data.ds = DOOR_STATES[entry.doorState];
  }
  if (entry.label !== undefined) data[`flags.${ID}.environment.label`] = entry.label;
  return data;
}
function lightData(scene, entry, creating, existing) {
  const data = creating ? {name: entry.name ?? 'MCP Light', x: entry.x, y: entry.y, walls: true, vision: false, hidden: false,
    config: {bright: 20, dim: 40, alpha: 0.5, angle: 360, luminosity: 0.5, negative: false}} : {};
  const s = existing ? source(existing) : {};
  checkPoint(scene, entry.x ?? s.x, entry.y ?? s.y);
  const levelIds = levels(scene, entry.levelIds, creating); if (levelIds) data.levels = levelIds;
  for (const key of ['name','x','y','elevation','rotation','hidden','walls','vision']) if (entry[key] !== undefined) data[key] = entry[key];
  const setConfig = (key,value) => {
    if (!creating) { data[`config.${key}`] = value; return; }
    const parts=key.split('.'); let target=data.config;
    while(parts.length>1){const key=parts.shift();target=target[key]??=( {} );} target[parts[0]]=value;
  };
  for (const key of ['bright','dim','color','alpha','angle','negative','luminosity']) if (own(entry,key)) setConfig(key,entry[key]);
  if (own(entry,'animation')) {
    if (entry.animation !== null && !Object.hasOwn(CONFIG.Canvas.lightAnimations, entry.animation)) throw new Error('Unknown light animation; inspect get-scene-environment for available names.');
    setConfig('animation.type',entry.animation);
  }
  if (entry.animationSpeed !== undefined) setConfig('animation.speed',entry.animationSpeed);
  if (entry.animationIntensity !== undefined) setConfig('animation.intensity',entry.animationIntensity);
  return data;
}
async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2,'0')).join('');
}
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value; }
export function makeEnvironmentHandlers({requireGM, requireWrites, serialize}) {
  async function read(raw) {
    requireGM(); const args = readArgs(raw), scene = sceneFor(args.sceneId);
    const result = {sceneId: scene.id, name: scene.name, dimensions: dimensions(scene), grid: clone(source(scene).grid), settings: settings(scene),
      levels: Array.from(scene.levels).map(l=>({id:l.id,name:l.name})), animations: Object.keys(CONFIG.Canvas.lightAnimations).slice(0,100), visionModes: Object.keys(CONFIG.Canvas.visionModes).slice(0,100)};
    for (const key of args.sections) {
      const entries = Array.from(scene[key]).sort((a,b)=>a.id.localeCompare(b.id));
      result[key] = {total: entries.length, entries: entries.slice(args.offset,args.offset+args.limit).map(key==='walls'?wallSummary:key==='lights'?lightSummary:tokenSummary), nextOffset: args.offset+args.limit < entries.length ? args.offset+args.limit : null};
    }
    return result;
  }
  async function manage(raw, kind) {
    requireWrites(); const args = manageArgs(raw,kind);
    return serialize(async () => {
      requireWrites(); const scene = sceneFor(args.sceneId), collection = scene[kind];
      // Fixed embedded types only. Never accept a document type from the caller.
      const type = kind === 'walls' ? 'Wall' : 'AmbientLight';
      const summarize = kind === 'walls' ? wallSummary : lightSummary;
      if (args.action === 'delete') {
        const existing = args.ids.filter(id=>collection.has(id)), previous = existing.map(id=>summarize(collection.get(id)));
        if (existing.length) await scene.deleteEmbeddedDocuments(type,existing);
        if (existing.some(id=>collection.has(id))) throw new Error('Some embedded objects were not removed. Inspect the selected scene.');
        return {success:true, sceneId:scene.id, deletedIds:existing, alreadyAbsentIds:args.ids.filter(id=>!existing.includes(id)), previous};
      }
      const creating = args.action === 'create', entries = args[kind];
      // Preflight every member before the first mutation.
      const data = entries.map(entry=> {
        const existing = creating ? null : collection.get(entry.id);
        if (!creating && !existing) throw new Error('One selected embedded object does not exist in this scene.');
        return (kind==='walls'?wallData:lightData)(scene,entry,creating,existing);
      });
      if (!creating) {
        const previous = entries.map(e=>summarize(collection.get(e.id)));
        await scene.updateEmbeddedDocuments(type,data.map((d,i)=>({_id:entries[i].id,...d})));
        if (entries.some(e=>!collection.has(e.id))) throw new Error('Embedded update needs inspection; a selected object is missing.');
        return {success:true,sceneId:scene.id,updated:entries.map(e=>summarize(collection.get(e.id))),previous};
      }
      const signature = await hash(JSON.stringify(canonical(args)));
      const ids = await Promise.all(entries.map((_,i)=>hash(`${ID}:${scene.id}:${kind}:${args.requestId}:${i}`).then(h=>h.slice(0,16))));
      const missing = [];
      for (let i=0;i<ids.length;i++) {
        const existing = collection.get(ids[i]);
        if (existing) { if (source(existing).flags?.[ID]?.environment?.signature !== signature) throw new Error('requestId already belongs to a different batch or collides with an existing object. Nothing was overwritten.'); }
        else {
          const label = entries[i].label;
          const d = {...data[i],_id:ids[i],flags:{[ID]:{environment:{requestId:args.requestId,signature,index:i,...(label?{label}:{})}}}};
          delete d[`flags.${ID}.environment.label`]; missing.push(d);
        }
      }
      if (missing.length) await scene.createEmbeddedDocuments(type,missing,{keepId:true});
      if (ids.some(id=>!collection.has(id))) throw new Error('Batch may be partially saved. Retry with exactly the same requestId and entries; no cleanup deletion was attempted.');
      return {success:true,sceneId:scene.id,requestId:args.requestId,createdIds:missing.map(d=>d._id),reusedIds:ids.filter(id=>!missing.some(d=>d._id===id)),entries:ids.map(id=>summarize(collection.get(id)))};
    });
  }
  async function visibility(raw) {
    requireWrites(); const args=visibilityArgs(raw);
    return serialize(async()=>{
      requireWrites(); const scene=sceneFor(args.sceneId), previous=settings(scene), patch={};
      if(args.tokenVision!==undefined)patch.tokenVision=args.tokenVision;
      if(args.globalLight!==undefined)patch['environment.globalLight.enabled']=args.globalLight;
      if(args.darkness!==undefined)patch['environment.darknessLevel']=args.darkness;
      if(args.fogMode!==undefined)patch['fog.mode']=FOG_MODES[args.fogMode];
      await scene.update(patch);
      return {success:true,sceneId:scene.id,previous,settings:settings(scene),explorationReset:false};
    });
  }
  async function tokenVision(raw) {
    requireWrites(); const args=tokenVisionArgs(raw);
    return serialize(async()=>{
      requireWrites(); const scene=sceneFor(args.sceneId);
      const previous=args.tokens.map(e=>{const t=scene.tokens.get(e.id);if(!t)throw new Error('Token not found in the selected scene.');return tokenSummary(t);});
      const updates=args.tokens.map(e=>{if(e.visionMode!==undefined&&!Object.hasOwn(CONFIG.Canvas.visionModes,e.visionMode))throw new Error('Unknown registered vision mode.');
        const patch={_id:e.id,...Object.fromEntries(Object.entries(e).filter(([k])=>k!=='id').map(([k,v])=>[`sight.${k}`,v]))};
        if(e.range!==undefined)patch['detectionModes.basicSight.range']=e.range;
        if(e.enabled!==undefined)patch['detectionModes.basicSight.enabled']=e.enabled;
        return patch;});
      await scene.updateEmbeddedDocuments('Token',updates);
      return {success:true,sceneId:scene.id,previous,updated:args.tokens.map(e=>tokenSummary(scene.tokens.get(e.id))),prototypeUpdated:false,explorationReset:false};
    });
  }
  async function resetFog(raw) {
    requireWrites(); const args=resetArgs(raw);
    return serialize(async()=>{
      requireWrites(); sceneFor(args.sceneId);
      if(!canvas.ready||canvas.scene?.id!==args.sceneId||typeof canvas.fog?.reset!=='function')throw new Error('View the selected scene in the connected GM browser before resetting its fog.');
      let timer, listener;
      const acknowledged=new Promise(resolve=>{listener=event=>{if(event?.sceneId===args.sceneId)resolve(true);};game.socket.on('resetFog',listener);timer=setTimeout(()=>resolve(false),5000);});
      try {
        await canvas.fog.reset();
        const confirmed=await acknowledged;
        return {success:confirmed,sceneId:args.sceneId,requested:true,confirmed,scope:'All users and all levels in this scene',message:confirmed?'Foundry confirmed fog exploration reset.':'Request sent but confirmation was not received. Inspect Foundry; do not retry automatically.'};
      } finally { clearTimeout(timer);game.socket.off('resetFog',listener); }
    });
  }
  return {read,walls:raw=>manage(raw,'walls'),lights:raw=>manage(raw,'lights'),visibility,tokenVision,resetFog};
}

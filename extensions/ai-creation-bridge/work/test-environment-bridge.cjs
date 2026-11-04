'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../outputs/portrait-bridge/ai-portrait-bridge');
let passed=0;
async function test(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
function collection(){const map=new Map();map[Symbol.iterator]=function*(){yield* this.values();};return map;}
function merge(target,data){for(const [key,value] of Object.entries(data)){if(key==='_id')continue;
 const parts=key.split('.');let obj=target;while(parts.length>1){const k=parts.shift();obj=obj[k]??={};}
 const k=parts[0];if(value&&typeof value==='object'&&!Array.isArray(value)){obj[k]??={};merge(obj[k],value);}else obj[k]=structuredClone(value);}}
const doc=(id,data)=>({id,_source:{_id:id,...structuredClone(data)}});
(async()=>{
 const p=await import(pathToFileURL(path.join(root,'environment-policy.mjs')).href);
 const {makeEnvironmentHandlers}=await import(pathToFileURL(path.join(root,'environment-module.mjs')).href);
 const sceneId='22h4aXB10oozGwOR',levelId='defaultLevel0000',tokenId='pcToken000000001';
 const calls=[];let gm=true,writes=true,partial=false;
 const scene={id:sceneId,name:'Town',dimensions:{width:2200,height:1650,sceneX:375,sceneY:275,sceneWidth:1448,sceneHeight:1086,size:25,distance:5},
  _source:{width:1448,height:1086,padding:0.25,grid:{size:25,distance:5},tokenVision:false,environment:{darknessLevel:0.2,globalLight:{enabled:true},hue:0.3},fog:{mode:1,reset:123,colors:{explored:'#999999'}}},
  levels:collection(),walls:collection(),lights:collection(),tokens:collection(),
  async createEmbeddedDocuments(type,data,options){assert(['Wall','AmbientLight'].includes(type));assert.equal(options.keepId,true);calls.push(['create',type,structuredClone(data)]);
   const map=type==='Wall'?this.walls:this.lights;
   for(let i=0;i<data.length;i++){assert(!map.has(data[i]._id));map.set(data[i]._id,doc(data[i]._id,data[i]));if(partial){partial=false;throw new Error('simulated partial create');}}
   return data.map(d=>map.get(d._id));},
  async updateEmbeddedDocuments(type,data){assert(['Wall','AmbientLight','Token'].includes(type));calls.push(['update',type,structuredClone(data)]);const map=type==='Wall'?this.walls:type==='AmbientLight'?this.lights:this.tokens;for(const d of data)merge(map.get(d._id)._source,d);},
  async deleteEmbeddedDocuments(type,ids){assert(['Wall','AmbientLight'].includes(type));calls.push(['delete',type,[...ids]]);const map=type==='Wall'?this.walls:this.lights;ids.forEach(id=>map.delete(id));},
  async update(data){assert(Object.keys(data).every(k=>['tokenVision','environment.darknessLevel','environment.globalLight.enabled','fog.mode'].includes(k)));calls.push(['settings',structuredClone(data)]);merge(this._source,data);}
 };
 scene.levels.set(levelId,{id:levelId,name:'Ground'});
 scene.tokens.set(tokenId,doc(tokenId,{name:'PC',actorId:'actor00000000001',x:950,y:850,width:1,height:1,texture:{src:'portrait.png',scaleX:1},sight:{enabled:false,range:0,angle:360,visionMode:'basic',brightness:0.2},detectionModes:{basicSight:{enabled:true,range:0}},hidden:false}));
 const sceneLayout=()=>JSON.stringify({width:scene._source.width,height:scene._source.height,padding:scene._source.padding,grid:scene._source.grid,levels:[...scene.levels]});
 const tokenLayout=()=>JSON.stringify(Object.fromEntries(['x','y','width','height','texture','hidden'].map(k=>[k,scene.tokens.get(tokenId)._source[k]])));
 global.game={scenes:new Map([[sceneId,scene]])};
 global.CONFIG={Canvas:{lightAnimations:{torch:{},pulse:{}},visionModes:{basic:{},darkvision:{}}}};
 const h=makeEnvironmentHandlers({requireGM(){if(!gm)throw new Error('GM required');},requireWrites(){if(!gm||!writes)throw new Error('Writes disabled');},serialize:fn=>fn()});
 await test('strict inputs reject scene operations, arbitrary flags, invalid geometry and unsafe reset',()=>{
  for(const raw of [{sceneId,action:'delete-scene',walls:[]},{sceneId,action:'delete',ids:['*']},{sceneId,action:'create',requestId:'too-short',walls:[{coordinates:[1,1,2,2]}]},{sceneId,action:'create',requestId:'valid-request-0001',walls:[{coordinates:[1,1,1,1]}]},{sceneId,action:'update',walls:[{id:tokenId,flags:{}}]}])assert.throws(()=>p.manageArgs(raw,'walls'));
  assert.throws(()=>p.visibilityArgs({sceneId,fogMode:'shared',reset:true}));assert.throws(()=>p.resetArgs({sceneId,confirmReset:false}));
  assert.throws(()=>p.tokenVisionArgs({sceneId,tokens:[{id:tokenId,actorLink:false}]}));
 });
 const wallBatch={sceneId,action:'create',requestId:'test-wall-batch-0001',walls:[{label:'Tavern wall',coordinates:[100,100,200,100]},{label:'Tavern door',coordinates:[200,100,225,100],door:'door',doorState:'closed'}]};
 let wallIds;
 await test('wall creation scopes levels, retries without duplicates and rejects changed requests',async()=>{
  const result=await h.walls(wallBatch);wallIds=result.createdIds;assert.equal(wallIds.length,2);assert.deepEqual(result.entries[0].levelIds,[levelId]);assert.equal(result.entries[1].door,'door');
  assert.deepEqual((await h.walls(wallBatch)).reusedIds,wallIds);assert.equal(scene.walls.size,2);
  await assert.rejects(()=>h.walls({...wallBatch,walls:[{coordinates:[101,100,200,100]},wallBatch.walls[1]]}),/different batch/);
 });
 await test('partial wall creation resumes missing members without deleting anything',async()=>{
  const batch={...wallBatch,requestId:'partial-wall-batch-001'};partial=true;
  await assert.rejects(()=>h.walls(batch),/partial create/);
  const count=scene.walls.size;const result=await h.walls(batch);assert.equal(result.createdIds.length,1);assert.equal(result.reusedIds.length,1);assert.equal(scene.walls.size,count+1);
 });
 await test('wall edits preflight all members, enforce padded canvas bounds and preserve other objects',async()=>{
  const before=JSON.stringify([...scene.walls].map(d=>d._source));const callCount=calls.length;
  await assert.rejects(()=>h.walls({sceneId,action:'update',walls:[{id:wallIds[0],blocksMovement:false},{id:'missingWall00001',blocksMovement:false}]}));
  await assert.rejects(()=>h.walls({sceneId,action:'update',walls:[{id:wallIds[0],coordinates:[100,100,2201,100]}]}));
  assert.equal(calls.length,callCount);assert.equal(JSON.stringify([...scene.walls].map(d=>d._source)),before);
  const result=await h.walls({sceneId,action:'update',walls:[{id:wallIds[1],doorState:'locked'}]});assert.equal(result.updated[0].doorState,'locked');
  await assert.rejects(()=>h.walls({sceneId,action:'update',walls:[{id:wallIds[0],doorState:'open'}]}),/non-door/);
 });
 let lightId;
 await test('light creation persists nested settings, darkness and wall behavior with retry safety',async()=>{
  const batch={sceneId,action:'create',requestId:'test-light-batch-0001',lights:[{name:'Blue fountain',x:600,y:500,bright:10,dim:30,color:'#3366ff',negative:true,animation:'torch',animationSpeed:3}]};
  const result=await h.lights(batch);lightId=result.createdIds[0];const s=scene.lights.get(lightId)._source;
  assert.deepEqual([s.config.bright,s.config.dim,s.config.color,s.config.negative,s.config.animation.type],[10,30,'#3366ff',true,'torch']);assert.equal(s.walls,true);assert.equal(s.vision,false);
  assert(!Object.keys(s).some(k=>k.startsWith('config.')));assert.equal((await h.lights(batch)).reusedIds[0],lightId);
 });
 await test('light patches preserve unrelated config; levels and animation names preflight safely',async()=>{
  scene.lights.get(lightId)._source.config.saturation=0.4;
  await h.lights({sceneId,action:'update',lights:[{id:lightId,color:'#ffcc66',hidden:true}]});
  assert.equal(scene.lights.get(lightId)._source.config.saturation,0.4);assert.equal(scene.lights.get(lightId)._source.x,600);
  await assert.rejects(()=>h.lights({sceneId,action:'update',lights:[{id:lightId,animation:'unknown'}]}),/Unknown/);
  const secondId='secondLevel00000';scene.levels.set(secondId,{id:secondId,name:'Upper'});
  await assert.rejects(()=>h.lights({sceneId,action:'create',requestId:'multilevel-light-001',lights:[{x:500,y:500}]}),/levelIds/);
  await h.lights({sceneId,action:'create',requestId:'multilevel-light-001',lights:[{x:500,y:500,levelIds:[levelId]}]});scene.levels.delete(secondId);
 });
 await test('paged inspection reports canvas geometry and only selected bounded sections',async()=>{
  const result=await h.read({sceneId,sections:['walls','lights','tokens'],limit:1});assert.equal(result.walls.entries.length,1);assert(result.walls.nextOffset);assert.equal(result.dimensions.width,2200);assert.equal(result.grid.size,25);assert.equal(result.tokens.entries[0].sight.enabled,false);
  assert.deepEqual(result.animations,['torch','pulse']);
 });
 const originalLayout=sceneLayout(),originalTokenLayout=tokenLayout();
 await test('scene visibility and fog modes preserve explored state and scene layout',async()=>{
  const result=await h.visibility({sceneId,tokenVision:true,globalLight:false,darkness:0.8,fogMode:'shared'});
  assert.equal(result.settings.fogMode,'shared');assert.equal(result.settings.darkness,0.8);assert.equal(scene._source.fog.reset,123);assert.equal(scene._source.fog.colors.explored,'#999999');assert.equal(result.explorationReset,false);
  assert.equal(sceneLayout(),originalLayout);assert.equal(tokenLayout(),originalTokenLayout);
 });
 await test('token vision changes only sight fields and never prototypes, position or detection modes',async()=>{
  const result=await h.tokenVision({sceneId,tokens:[{id:tokenId,enabled:true,range:60,visionMode:'darkvision'}]});assert.equal(result.updated[0].sight.range,60);assert.equal(result.prototypeUpdated,false);
  assert.equal(tokenLayout(),originalTokenLayout);assert.deepEqual(scene.tokens.get(tokenId)._source.detectionModes,{basicSight:{enabled:true,range:60}});
  await assert.rejects(()=>h.tokenVision({sceneId,tokens:[{id:tokenId,visionMode:'unknown'}]}),/Unknown/);
 });
 await test('embedded deletion is restricted to explicit Wall/Light IDs and safe to retry',async()=>{
  const result=await h.walls({sceneId,action:'delete',ids:[wallIds[0]]});assert.deepEqual(result.deletedIds,[wallIds[0]]);
  assert.deepEqual((await h.walls({sceneId,action:'delete',ids:[wallIds[0]]})).alreadyAbsentIds,[wallIds[0]]);
  await h.lights({sceneId,action:'delete',ids:[lightId]});assert.equal(sceneLayout(),originalLayout);assert.equal(tokenLayout(),originalTokenLayout);
 });
 const listeners=new Set();let resetCalls=0;
 game.socket={on:(event,fn)=>{assert.equal(event,'resetFog');listeners.add(fn);},off:(event,fn)=>listeners.delete(fn)};
 global.canvas={ready:true,scene,fog:{reset:async()=>{resetCalls++;for(const fn of listeners)fn({sceneId});}}};
 await test('fog reset requires explicit intent, current scene, and native acknowledgement',async()=>{
  await assert.rejects(()=>h.resetFog({sceneId,confirmReset:false}));assert.equal(resetCalls,0);
  canvas.scene={id:'anotherScene0001'};await assert.rejects(()=>h.resetFog({sceneId,confirmReset:true}),/View/);canvas.scene=scene;
  const result=await h.resetFog({sceneId,confirmReset:true});assert(result.confirmed);assert.equal(resetCalls,1);assert.equal(listeners.size,0);
  const originalTimer=global.setTimeout;global.setTimeout=(fn,ms)=>originalTimer(fn,ms===5000?5:ms);canvas.fog.reset=async()=>{};
  try {const result=await h.resetFog({sceneId,confirmReset:true});assert.equal(result.confirmed,false);assert.equal(result.success,false);assert.match(result.message,/do not retry automatically/);} finally {global.setTimeout=originalTimer;}
  assert.equal(listeners.size,0);
 });
 await test('GM/write gates apply to all mutations and reset; scene deletion stays unavailable',async()=>{
  writes=false;
  for(const fn of [()=>h.walls(wallBatch),()=>h.lights({sceneId,action:'delete',ids:[lightId]}),()=>h.visibility({sceneId,darkness:0}),()=>h.tokenVision({sceneId,tokens:[{id:tokenId,enabled:false}]}),()=>h.resetFog({sceneId,confirmReset:true})])await assert.rejects(fn,/disabled/);
  gm=false;await assert.rejects(()=>h.read({sceneId}),/GM/);gm=true;writes=true;
  const {assertAllowedTool}=require('../outputs/portrait-bridge/local/tool-policy.cjs');assert.throws(()=>assertAllowedTool('delete-scene'));
  assert(!calls.some(c=>c[1]==='Scene'));assert.equal(sceneLayout(),originalLayout);assert.equal(tokenLayout(),originalTokenLayout);
 });
 console.log(`ALL ${passed} ENVIRONMENT CHECKS PASSED — no live scene edits or fog resets`);
})().catch(error=>{console.error(error);process.exitCode=1;});

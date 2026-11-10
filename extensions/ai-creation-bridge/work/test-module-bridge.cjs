const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const path = require('node:path');

const root = path.resolve(__dirname, '../outputs/portrait-bridge');
const sceneId = 'a'.repeat(16), tokenId = 'b'.repeat(16), mountId = 'c'.repeat(16), levelId = 'd'.repeat(16);
const token = {id:tokenId, uuid:'Scene.' + sceneId + '.Token.' + tokenId, name:'Guard',
  actor:{id:tokenId, type:'npc', items:new Map()}, object:{center:{x:50,y:50}}};
const mount = {...token, id:mountId};
const scene = {id:sceneId, dimensions:{width:1000,height:1000}, tokens:new Map([[tokenId,token],[mountId,mount]]),
  tiles:new Map(), levels:new Map([[levelId,{id:levelId}]])};
const modules = new Map(['item-piles','itempilesdnd5e','monks-active-tiles','tagger','Rideable','sequencer','JB2A_DnD5e',
  'fxmaster','animater','vtta-tokenizer','monks-tokenbar','routinglib','soundfxlibrary'].map(id => [id,{id,active:true}]));
globalThis.crypto ??= webcrypto;
globalThis.game = {world:{id:'fixture'},system:{id:'dnd5e'},modules,
  scenes:new Map([[sceneId,scene]]),actors:new Map([[tokenId,token.actor]])};
globalThis.canvas = {ready:true,scene,grid:{getOffset:({x,y}) => ({i:y/50,j:x/50})}};

async function main() {
  const {makeModuleHandlers} = await import(pathToFileURL(path.join(root,'ai-portrait-bridge/module-module.mjs')));
  const {definitions,createModuleTools} = require(path.join(root,'local/module-tools.cjs'));
  let gm = true, writes = true, result;
  const handlers = makeModuleHandlers({
    requireGM() {if (!gm) throw Error('GM required');},
    requireWrites() {if (!writes) throw Error('Writes disabled');},
    serialize: run => run()
  });
  const calls = [];
  const client = createModuleTools({async query(name,args) {
    calls.push(name);
    if (name === 'ai-portrait-bridge.status') return {moduleTools:true};
    return handlers[name.split('.').at(-1)](args);
  }});
  const run = client.handle;
  assert.deepEqual(Object.keys(handlers).sort(),definitions.map(tool => tool.name).sort());
  await assert.rejects(run('get-module-capabilities',{script:'arbitrary'}),/Unexpected field/);
  assert.equal(calls.length,0);
  gm = false;
  await assert.rejects(run('get-module-capabilities',{}),/GM required/);
  gm = true;
  writes = false;
  assert.equal((await run('get-module-capabilities',{})).worldId,'fixture');
  await assert.rejects(run('open-tokenizer',{actorId:tokenId}),/Writes disabled/);
  writes = true;
  console.log('PASS tool definitions, fixed dispatch, GM access and write permissions');

  const pile = {sceneId,tokenId,mode:'merchant',buyMultiplier:1.2};
  let pileSettings;
  game.itempiles = {API:{
    isValidItemPile: t => t === token && !!pileSettings,
    isItemPileMerchant: t => t === token && pileSettings.type === 'merchant',
    async turnTokensIntoItemPiles(targets,options) {assert.deepEqual(targets,[token]);pileSettings = options.pileSettings;},
    async updateItemPile(target,settings) {assert.equal(target,token);pileSettings = settings;}
  }};
  token.actorLink = true;
  await assert.rejects(run('configure-item-pile',pile),/unlinked NPC/);
  token.actorLink = false;
  assert.equal((await run('configure-item-pile',pile)).type,'merchant');
  assert.deepEqual(pileSettings,{enabled:true,type:'merchant',deleteWhenEmpty:false,buyPriceModifier:1.2});
  assert.equal((await run('configure-item-pile',{...pile,buyMultiplier:2})).success,true);
  assert.equal(pileSettings.buyPriceModifier,2);
  console.log('PASS native merchant conversion protects linked actors and disables automatic empty-pile deletion');

  game.MonksActiveTiles = {triggerTile() {}};
  scene.createEmbeddedDocuments = async (kind, entries, options) => {
    assert.equal(kind,'Tile');
    assert.equal(options.keepId,true);
    return entries.map(data => {
      const tile = {...data,id:data._id,getFlag:(mod,key) => data.flags[mod]?.[key],
        async update(values) {data.flags['monks-active-tiles'].active = values['flags.monks-active-tiles.active'];}};
      scene.tiles.set(tile.id,tile);
      return tile;
    });
  };
  const trigger = {action:'create',sceneId,requestId:'one-pressure-tile',label:'Pressure plate',x:20,y:25,width:50,
    height:60,trigger:'enter',visibility:'show',targetTokenIds:[tokenId]};
  await assert.rejects(run('manage-active-tile',{...trigger,targetTokenIds:['x'.repeat(16)]}),/does not exist/);
  result = await run('manage-active-tile',trigger);
  const tileId = result.tile.id;
  const flags = scene.tiles.get(tileId).flags['monks-active-tiles'];
  assert.equal(flags.actions[0].data.entity.id,token.uuid);
  assert.equal(flags.pertoken,true);
  assert.equal((await run('manage-active-tile',trigger)).reused,true);
  await assert.rejects(run('manage-active-tile',{...trigger,x:21}),/different tile/);
  assert.equal(scene.tiles.size,1);
  assert.equal((await run('manage-active-tile',{sceneId,action:'set-enabled',tileId,enabled:false})).tile.active,false);
  console.log('PASS idempotent native tile setup, same-scene token scoping and disable');

  let tokenTags = [];
  globalThis.Tagger = {
    getTags: () => tokenTags,
    async addTags(docs,tags) {assert.deepEqual(docs,[token]);tokenTags = tags;}
  };
  assert.deepEqual((await run('manage-scene-tags',{sceneId,documentType:'token',ids:[tokenId],action:'add',tags:['Ambush']})).entries[0].tags,['Ambush']);
  let riders = [];
  modules.get('Rideable').api = {RideableFlags:{RiderTokenIDs: t => t === mount ? riders : [], isRider: t => riders.includes(t.id)}};
  game.Rideable = {Mount: docs => {riders = docs.map(t => t.id);}, UnMount: () => {riders = [];}};
  const riding = {sceneId,riderIds:[tokenId],mountId};
  assert.equal((await run('manage-token-riding',{...riding,action:'mount'})).confirmed,true);
  assert.equal((await run('manage-token-riding',{...riding,action:'dismount'})).confirmed,true);
  console.log('PASS named Tagger and Rideable calls');

  const assetId = 'jb2a.spark.blue';
  let file = 'modules/JB2A_DnD5e/spark.webm';
  globalThis.Sequencer = {Database:{entryExists:() => true, getPathsUnder:() => [assetId], getAllFileEntries:() => [file]}};
  let played = 0;
  globalThis.Sequence = class {
    effect() {return this;}
    file(id) {assert.equal(id,assetId);return this;}
    atLocation(point) {assert.equal(point,token.object);return this;}
    scale() {return this;}
    opacity() {return this;}
    duration() {return this;}
    async play() {played++;}
  };
  assert.deepEqual((await run('search-module-media',{library:'jb2a',query:'spark'})).entries,[assetId]);
  const media = {sceneId,library:'jb2a',assetId,tokenId};
  for (const invalid of ['https://example.org/a.webm','modules/JB2A_DnD5e/%252e%252e/a.webm','modules/JB2A_DnD5e/%2e%2e/a.webm']) {
    const original = file;
    file = invalid;
    await assert.rejects(run('play-module-media',media),/unsupported media paths/);
    file = original;
  }
  assert.equal(played,0);
  await run('play-module-media',media);
  assert.equal(played,1);
  const sounds = 'modules/soundfxlibrary/Combat/Loops/Swordfight';
  const browsed = [];
  globalThis.foundry = {applications:{apps:{FilePicker:{implementation:{async browse(source,folder) {
    assert.equal(source,'data');
    browsed.push(folder);
    if (folder === 'modules/soundfxlibrary/Combat/Loops') {
      return {dirs:['/' + sounds + '/', 'modules/another-module', 'modules/soundfxlibrary/%2e%2e/elsewhere']};
    }
    if (folder === sounds) return {files:['/' + sounds + '/clash.mp3'],dirs:[sounds]};
    return {};
  }}}}}};
  assert.deepEqual((await run('search-module-media',{library:'soundfxlibrary',query:'clash'})).entries,[sounds + '/clash.mp3']);
  assert.equal(browsed.length,13);
  modules.get('animater').api = {
    recipes: () => [{id:'spark',name:'Spark',stages:[{kind:'cast',assets:[assetId],persist:true,duration:60000}]}],
    async play(recipe, context) {
      assert.equal(recipe.stages[0].persist,false);
      assert.equal(recipe.stages[0].duration,5000);
      assert.equal(context.source,token.object);
    }
  };
  assert.equal((await run('use-animater-recipe',{action:'list'})).total,1);
  await run('use-animater-recipe',{action:'play',sceneId,recipeId:'spark',sourceTokenId:tokenId});
  modules.get('fxmaster').api = {presets:{listValid: () => ['fog'], async play(preset,options) {
    assert.equal(preset,'fog');assert.equal(options.scene,scene);return true;
  }}};
  assert.equal((await run('manage-fxmaster-preset',{action:'apply',preset:'fog',sceneId})).success,true);
  console.log('PASS media path restrictions, bounded Animater previews and scene-specific FXMaster calls');

  modules.get('vtta-tokenizer').api = {async tokenizeActor(actor) {assert.equal(actor,token.actor);}};
  assert.equal((await run('open-tokenizer',{actorId:tokenId})).opened,true);
  game.MonksTokenBar = {async requestRoll(tokens, options) {
    assert.deepEqual(tokens,[token.object]);
    assert.equal(options.request,'save:dex');
    assert.equal(options.silent,false);
    assert.equal(options.fastForward,false);
    return {};
  }};
  await run('use-monks-tokenbar',{sceneId,tokenIds:[tokenId],action:'roll-dialog',rollType:'save',ability:'dex',visibility:'gmroll'});
  globalThis.routinglib = {async calculatePath(from,to,options) {
    assert.deepEqual(from,{x:1,y:1});
    assert.deepEqual(to,{x:2,y:3});
    assert.equal(options.token,token.object);
    return {path:[from,to],cost:10};
  }, cancelPathfinding() {}};
  result = await run('estimate-routinglib-path',{sceneId,tokenId,x:100,y:150,maxDistance:30});
  assert.equal(result.cost,10);
  assert.deepEqual(token.object.center,{x:50,y:50});
  console.log('PASS Tokenizer and roll dialogs require GM follow-through, and routing does not move tokens');
}

main().catch(error => {console.error(error);process.exitCode = 1;});

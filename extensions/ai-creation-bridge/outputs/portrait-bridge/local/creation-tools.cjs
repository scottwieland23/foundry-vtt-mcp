'use strict';
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const categories = ['all','creature','spell','item','class','subclass','race','background','feat','classFeature','subclassFeature','optionalfeature','vehicle'];
const def = (name, description, properties, required, readOnly) => ({name, description,
  inputSchema: {type: 'object', properties, required, additionalProperties: false},
  annotations: {readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false}});
const definitions = [
  def('search-plutonium', 'Search installed Plutonium names without importing content. Returns compact IDs/names/sources only, default 10 and maximum 20 results. Fetch details only for selected IDs. No startup catalog dump. Does not include external homebrew absent from the installed index.', {
    query: {type: 'string', minLength: 2, maxLength: 100}, category: {type: 'string', enum: categories, default: 'all'},
    source: {type: 'string', description: 'Optional exact source abbreviation returned by search, e.g. PHB or XPHB.'},
    limit: {type: 'integer', minimum: 1, maximum: 20, default: 10}, offset: {type: 'integer', minimum: 0, maximum: 10000, default: 0}
  }, ['query'], true),
  def('get-plutonium-entry', 'Read one selected Plutonium entry using an ID returned by search-plutonium. Returns bounded detail text, not a whole book or catalog. Never imports or changes documents. Search again after a Plutonium upgrade.', {
    entryId: {type: 'integer', minimum: 0}, maxCharacters: {type: 'integer', minimum: 200, maximum: 12000, default: 4000}
  }, ['entryId'], true),
  def('create-player-character', 'Create one D&D5e PC from a prepared build in Player Characters. The assistant chooses any random concept BEFORE calling. Include final ability scores, HP, skills/proficiencies and all selected class, race, subclass, background, feature and equipment Item system data. Total class levels 1–20. This does not resolve Plutonium advancement dialogs or invent missing choices. Use existing compendium tools and focused Plutonium searches to prepare data. Stable requestId prevents retry duplicates. Never overwrites actors, assigns players, places tokens or modifies/deletes scenes.', {
    requestId: {type: 'string', minLength: 16, maxLength: 64}, name: {type: 'string', maxLength: 120},
    system: {type: 'object', description: 'Prepared native D&D5e character data; abilities.str/dex/con/int/wis/cha.value and attributes.hp.value required. Level is derived from class items. Supply HP.max or configured HitPoints advancement records. Include biography and selected proficiencies here.', additionalProperties: true},
    items: {type: 'array', minItems: 1, maxItems: 80, items: {type: 'object', properties: {name: {type: 'string'}, type: {type: 'string', enum: ['class','subclass','race','background','feat','weapon','equipment','consumable','tool','loot','container']}, system: {type: 'object', additionalProperties: true}}, required: ['name','type','system'], additionalProperties: false}},
    portraitPath: {type: 'string', description: 'Optional ai-portraits path previously returned by upload-portrait.'}
  }, ['requestId','name','system','items'], false)
];
function createCreationTools(client) {
  const policy = import(pathToFileURL(path.join(__dirname, 'creation-policy.mjs')).href);
  return {async handle(name, args) {
    const p = await policy;
    const routes = {'search-plutonium': ['searchPlutonium', p.searchArgs], 'get-plutonium-entry': ['getPlutoniumEntry', p.entryArgs], 'create-player-character': ['createPlayerCharacter', p.pcArgs]};
    const route = routes[name]; if (!route) throw new Error('Unsupported creation tool.');
    route[1](args);
    const status = await client.query('ai-portrait-bridge.status', {});
    if (!['1.4.0','1.5.0'].includes(status?.version)) throw new Error('Refresh Foundry to load AI Creation Bridge 1.4.0 before using these tools.');
    return client.query(`ai-portrait-bridge.${route[0]}`, args);
  }};
}
module.exports = {definitions, createCreationTools};

// Shared schema and argument validation for the local server and the GM browser.
const id = {type: 'string', pattern: '^[A-Za-z0-9]{16}$'};
const bool = {type: 'boolean'};
const text = (maxLength = 100, minLength = 1) => ({type: 'string', minLength, maxLength});
const choice = (...values) => ({type: 'string', enum: values});
const number = (minimum, maximum, integer = false) => ({type: integer ? 'integer' : 'number', minimum, maximum});
const ids = (maxItems = 8) => ({type: 'array', items: id, minItems: 1, maxItems, uniqueItems: true});
const pixels = number(0, 1000000, true);
const requestId = {type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$'};
const library = choice('jb2a', 'ggg-sfx', 'ggg-vfx', 'soundfxlibrary');
const page = {query: text(80, 0), limit: number(1, 25, true), offset: number(0, 100000, true)};
const define = (name, description, properties, required, readOnlyHint = false, idempotentHint = true) => ({
  name, description, inputSchema: {type: 'object', additionalProperties: false, properties, required},
  annotations: {readOnlyHint, idempotentHint, destructiveHint: false, openWorldHint: false}
});

export const definitions = [
  define('get-module-capabilities', 'Inspect live module activation, versions, dependencies and bridge API readiness in the connected world.', {}, [], true),
  define('configure-item-pile', 'Inspect or configure an existing unlinked NPC token as a native Item Piles merchant, container or loot pile. Use existing actor inventory as stock. No purchases or currency transfers.', {
    sceneId: id, tokenId: id, mode: choice('inspect', 'merchant', 'container', 'loot'), closed: bool, locked: bool,
    buyMultiplier: number(0.1, 10), sellMultiplier: number(0, 1)
  }, ['sceneId', 'tokenId', 'mode']),
  define('manage-active-tile', 'Create or inspect a Monk’s Active Tiles trigger, or enable/disable a bridge-created trigger. Enter or click reveals or hides only the named same-scene tokens. Coordinates are padded canvas pixels. Creation uses a stable request ID. The tile is transparent and uses the scene’s sole level unless levelId is supplied.', {
    sceneId: id, action: choice('create', 'inspect', 'set-enabled'), tileId: id, requestId, levelId: id,
    label: text(), x: pixels, y: pixels, width: number(1, 1000000, true), height: number(1, 1000000, true),
    trigger: choice('enter', 'click'), visibility: choice('show', 'hide'), targetTokenIds: ids(16),
    oncePerToken: bool, enabled: bool
  }, ['sceneId', 'action']),
  define('manage-scene-tags', 'Read, add or remove explicit plain Tagger tags on specified tokens, tiles, walls, lights, drawings or regions in one scene.', {
    sceneId: id, documentType: choice('token', 'tile', 'wall', 'light', 'drawing', 'region'), ids: ids(20),
    action: choice('get', 'add', 'remove'),
    tags: {type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$'}}
  }, ['sceneId', 'documentType', 'ids', 'action']),
  define('manage-token-riding', 'Inspect, mount or dismount selected Rideable riders in the viewed scene. Mount uses normal module rules and requires mountId.', {
    sceneId: id, action: choice('inspect', 'mount', 'dismount'), riderIds: ids(), mountId: id
  }, ['sceneId', 'action', 'riderIds']),
  define('search-module-media', 'Find a short page of media IDs from the installed JB2A, GGG or SoundFx Library. Search terms match names and IDs.', {library, ...page}, ['library'], true),
  define('play-module-media', 'Play a short visual effect or sound from a verified installed media entry in the viewed scene. Visuals require a token or a canvas point. Sounds use a bounded volume. Playback broadcasts to players viewing the scene.', {
    sceneId: id, library, assetId: text(400), tokenId: id, x: pixels, y: pixels,
    volume: number(0, 0.5), scale: number(0.1, 3), opacity: number(0, 1), durationMs: number(100, 15000, true)
  }, ['sceneId', 'library', 'assetId'], false, false),
  define('manage-fxmaster-preset', 'List or apply an installed FXMaster preset to a selected scene, or stop one named preset. Applies alongside other presets.', {
    action: choice('list', 'apply', 'stop'), sceneId: id, preset: text(), topDown: bool, ...page
  }, ['action']),
  define('use-animater-recipe', 'List short metadata for saved Animater recipes, or play a verified visual recipe on explicit tokens in the viewed scene. Only bounded visual stages from installed media are playable through this tool.', {
    action: choice('list', 'play'), sceneId: id, recipeId: text(), sourceTokenId: id, targetTokenIds: ids(), ...page
  }, ['action'], false, false),
  define('open-tokenizer', 'Open the native Tokenizer editor for a world actor in the GM tab. The GM uses the editor to preview and save.', {actorId: id}, ['actorId']),
  define('use-monks-tokenbar', 'Set movement mode for specified tokens or open a saving throw or ability check request dialog for the GM to review. The dialog waits for the GM to send the request.', {
    sceneId: id, tokenIds: ids(20), action: choice('movement', 'roll-dialog'), movement: choice('free', 'none', 'combat'),
    rollType: choice('save', 'ability'), ability: choice('str', 'dex', 'con', 'int', 'wis', 'cha'), dc: number(1, 35, true),
    visibility: choice('roll', 'gmroll', 'blindroll', 'selfroll')
  }, ['sceneId', 'tokenIds', 'action']),
  define('estimate-routinglib-path', 'Estimate a bounded path for a placed token in the viewed scene. Supply the destination in padded canvas pixels and a maximum distance in scene units.', {
    sceneId: id, tokenId: id, x: pixels, y: pixels, maxDistance: number(1, 200)
  }, ['sceneId', 'tokenId', 'x', 'y', 'maxDistance'], true)
];

function check(schema, value, field) {
  switch (schema.type) {
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(field + ' must be an object.');
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) throw Error('Unexpected field: ' + key);
        check(schema.properties[key], value[key], key);
      }
      for (const key of schema.required) if (!Object.hasOwn(value, key)) throw Error('Missing field: ' + key);
      break;
    case 'string':
      if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) ||
          value.length > (schema.maxLength ?? 400) || /[\u0000-\u001f\u007f]/.test(value) ||
          (schema.pattern && !new RegExp(schema.pattern).test(value)) ||
          (schema.enum && !schema.enum.includes(value))) throw Error('Invalid ' + field + '.');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw Error(field + ' must be a boolean.');
      break;
    case 'array':
      if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems ||
          (schema.uniqueItems && new Set(value).size !== value.length)) throw Error('Invalid ' + field + ' list.');
      for (const item of value) check(schema.items, item, field);
      break;
    case 'integer':
    case 'number':
      if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) ||
          value < schema.minimum || value > schema.maximum) throw Error('Invalid ' + field + '.');
      break;
  }
}

export function validate(name, args) {
  const schema = definitions.find(tool => tool.name === name)?.inputSchema;
  if (!schema) throw Error('Unknown module tool.');
  check(schema, args, name);
  return args;
}

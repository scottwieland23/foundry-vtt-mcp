export const SENSES = Object.freeze({none: 0, limited: 10, normal: 20});
export const DIRECTIONS = Object.freeze({both: 0, left: 1, right: 2});
export const DOORS = Object.freeze({none: 0, door: 1, secret: 2});
export const DOOR_STATES = Object.freeze({closed: 0, open: 1, locked: 2});
export const FOG_MODES = Object.freeze({disabled: 0, individual: 1, shared: 2});
export function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unexpected field: ${key}`);
}
export function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9]{16}$/.test(value)) throw new Error('Invalid document ID.'); return value; }
function number(value, min, max, integer = false) { if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Expected ${integer ? 'integer' : 'number'} in ${min}–${max}.`); }
function bool(value) { if (typeof value !== 'boolean') throw new Error('Expected a boolean.'); }
function choice(value, values) { if (!Object.hasOwn(values, value)) throw new Error('Unsupported setting value.'); }
function list(value, max) { if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error(`Supply 1–${max} entries.`); }
function unique(values) { if (new Set(values).size !== values.length) throw new Error('Duplicate IDs are not allowed.'); }
function label(value) { if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[<>\u0000-\u001f]/.test(value)) throw new Error('Use a plain label of 1–100 characters.'); }
function levelIds(value) { list(value, 10); value.forEach(id); unique(value); }
function animationKey(value) { if (value !== null && (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(value))) throw new Error('Invalid registered effect name.'); }
export function readArgs(raw) {
  exact(raw, ['sceneId', 'sections', 'offset', 'limit']); id(raw.sceneId);
  const sections = raw.sections ?? ['walls', 'lights']; list(sections, 3); unique(sections);
  if (sections.some(s => !['walls', 'lights', 'tokens'].includes(s))) throw new Error('Unsupported scene section.');
  const offset = raw.offset ?? 0, limit = raw.limit ?? 25;
  number(offset, 0, 100000, true); number(limit, 1, 100, true);
  return {...raw, sections, offset, limit};
}
export function manageArgs(raw, kind) {
  const field = kind === 'walls' ? 'walls' : 'lights';
  exact(raw, ['sceneId', 'action', 'requestId', field, 'ids']); id(raw.sceneId);
  if (!['create', 'update', 'delete'].includes(raw.action)) throw new Error('Use create, update or delete; no scene operations exist.');
  if (raw.action === 'delete') {
    if (raw[field] !== undefined || raw.requestId !== undefined) throw new Error('Deletion accepts explicit embedded IDs only.');
    list(raw.ids, kind === 'walls' ? 100 : 50); raw.ids.forEach(id); unique(raw.ids); return raw;
  }
  if (raw.ids !== undefined) throw new Error('Use explicit entry IDs for updates, or ids only for deletion.');
  const creating = raw.action === 'create';
  if (creating) {
    if (typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(raw.requestId)) throw new Error('Creation requires a stable 16–64 character requestId for retries.');
  } else if (raw.requestId !== undefined) throw new Error('requestId is used only for creation.');
  list(raw[field], kind === 'walls' ? 100 : 50);
  for (const entry of raw[field]) {
    const wallKeys = ['id', 'label', 'coordinates', 'levelIds', 'blocksMovement', 'sight', 'light', 'sound', 'direction', 'door', 'doorState'];
    const lightKeys = ['id', 'name', 'x', 'y', 'levelIds', 'elevation', 'rotation', 'hidden', 'walls', 'vision', 'bright', 'dim', 'color', 'alpha', 'angle', 'negative', 'luminosity', 'animation', 'animationSpeed', 'animationIntensity'];
    exact(entry, kind === 'walls' ? wallKeys : lightKeys);
    if (creating && entry.id !== undefined) throw new Error('Creation IDs are assigned by the bridge.');
    if (!creating) { id(entry.id); if (Object.keys(entry).length < 2) throw new Error('Supply a change as well as the ID.'); }
    if (entry.levelIds !== undefined) levelIds(entry.levelIds);
    if (kind === 'walls') {
      if (creating || entry.coordinates !== undefined) {
        if (!Array.isArray(entry.coordinates) || entry.coordinates.length !== 4) throw new Error('Wall coordinates must be [x1,y1,x2,y2].');
        entry.coordinates.forEach(v => number(v, 0, 1000000, true));
        if (entry.coordinates[0] === entry.coordinates[2] && entry.coordinates[1] === entry.coordinates[3]) throw new Error('Wall endpoints must differ.');
      }
      if (entry.label !== undefined) label(entry.label);
      if (entry.blocksMovement !== undefined) bool(entry.blocksMovement);
      for (const key of ['sight', 'light', 'sound']) if (entry[key] !== undefined) choice(entry[key], SENSES);
      if (entry.direction !== undefined) choice(entry.direction, DIRECTIONS);
      if (entry.door !== undefined) choice(entry.door, DOORS);
      if (entry.doorState !== undefined) { choice(entry.doorState, DOOR_STATES); if (entry.door === 'none') throw new Error('A non-door wall cannot have a door state.'); }
    } else {
      if (creating) { number(entry.x, 0, 1000000, true); number(entry.y, 0, 1000000, true); }
      for (const key of ['x', 'y']) if (entry[key] !== undefined) number(entry[key], 0, 1000000, true);
      if (entry.name !== undefined) label(entry.name);
      for (const key of ['hidden', 'walls', 'vision', 'negative']) if (entry[key] !== undefined) bool(entry[key]);
      for (const key of ['bright', 'dim']) if (entry[key] !== undefined) number(entry[key], 0, 10000);
      for (const key of ['alpha', 'luminosity']) if (entry[key] !== undefined) number(entry[key], 0, 1);
      for (const key of ['angle', 'rotation']) if (entry[key] !== undefined) number(entry[key], 0, 360);
      if (entry.elevation !== undefined) number(entry.elevation, -100000, 100000);
      if (entry.color !== undefined && entry.color !== null && !/^#[a-fA-F0-9]{6}$/.test(entry.color)) throw new Error('Use #RRGGBB or null for light color.');
      if (entry.animation !== undefined) animationKey(entry.animation);
      if (entry.animationSpeed !== undefined) number(entry.animationSpeed, 0, 10, true);
      if (entry.animationIntensity !== undefined) number(entry.animationIntensity, 1, 10, true);
    }
  }
  if (!creating) unique(raw[field].map(e => e.id));
  return raw;
}
export function visibilityArgs(raw) {
  exact(raw, ['sceneId', 'tokenVision', 'globalLight', 'darkness', 'fogMode']); id(raw.sceneId);
  if (Object.keys(raw).length < 2) throw new Error('Supply at least one visibility setting.');
  for (const key of ['tokenVision', 'globalLight']) if (raw[key] !== undefined) bool(raw[key]);
  if (raw.darkness !== undefined) number(raw.darkness, 0, 1);
  if (raw.fogMode !== undefined) choice(raw.fogMode, FOG_MODES);
  return raw;
}
export function tokenVisionArgs(raw) {
  exact(raw, ['sceneId', 'tokens']); id(raw.sceneId); list(raw.tokens, 20);
  for (const token of raw.tokens) {
    exact(token, ['id', 'enabled', 'range', 'angle', 'visionMode']); id(token.id);
    if (Object.keys(token).length < 2) throw new Error('Supply a vision change.');
    if (token.enabled !== undefined) bool(token.enabled);
    if (token.range !== undefined) number(token.range, 0, 10000);
    if (token.angle !== undefined) number(token.angle, 0, 360);
    if (token.visionMode !== undefined) { animationKey(token.visionMode); if (!token.visionMode) throw new Error('Specify a registered vision mode.'); }
  }
  unique(raw.tokens.map(t => t.id)); return raw;
}
export function resetArgs(raw) {
  exact(raw, ['sceneId', 'confirmReset']); id(raw.sceneId);
  if (raw.confirmReset !== true) throw new Error('Fog reset erases ALL users\' exploration in this scene. Explicit confirmReset:true is required.');
  return raw;
}

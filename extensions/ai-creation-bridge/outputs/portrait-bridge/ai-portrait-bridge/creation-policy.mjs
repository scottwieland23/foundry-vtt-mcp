export const CATEGORIES = Object.freeze({creature: [1], spell: [2], background: [3], item: [4], class: [5], feat: [7], race: [10], optionalfeature: [8, 22, 23, 26, 27, 28, 29, 32, 33, 34, 37, 38, 39], vehicle: [31], classFeature: [30], subclass: [40], subclassFeature: [41]});
const ITEM_TYPES = new Set(['class', 'subclass', 'race', 'background', 'feat', 'weapon', 'equipment', 'consumable', 'tool', 'loot', 'container']);
export function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unexpected field: ${key}`);
}
function string(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}.`);
  return value.trim();
}
export function searchArgs(raw) {
  exact(raw, ['query', 'category', 'source', 'limit', 'offset']);
  const query = string(raw.query, 100, 'search query');
  if (query.length < 2) throw new Error('Use at least two search characters.');
  const category = raw.category ?? 'all';
  if (category !== 'all' && !Object.hasOwn(CATEGORIES, category)) throw new Error('Unsupported search category.');
  const limit = raw.limit ?? 10, offset = raw.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid search page: limit 1–20; offset 0–10000.');
  const source = raw.source === undefined ? undefined : string(raw.source, 40, 'source');
  return {query, category, source, limit, offset};
}
export function entryArgs(raw) {
  exact(raw, ['entryId', 'maxCharacters']);
  if (!Number.isInteger(raw.entryId) || raw.entryId < 0 || raw.entryId > 1000000) throw new Error('Invalid entryId.');
  const maxCharacters = raw.maxCharacters ?? 4000;
  if (!Number.isInteger(maxCharacters) || maxCharacters < 200 || maxCharacters > 12000) throw new Error('maxCharacters must be 200–12000.');
  return {entryId: raw.entryId, maxCharacters};
}
function checkTree(value, depth = 0) {
  if (depth > 30) throw new Error('Character data is too deeply nested.');
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe character field.');
    checkTree(value[key], depth + 1);
  }
}
export function pcArgs(raw) {
  exact(raw, ['requestId', 'name', 'system', 'items', 'portraitPath']);
  const requestId = string(raw.requestId, 64, 'requestId');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(requestId)) throw new Error('Use a stable 16–64 character requestId for retries.');
  const name = string(raw.name, 120, 'character name');
  if (/[<>\u0000-\u001f]/.test(name)) throw new Error('Use a plain character name.');
  if (!raw.system || typeof raw.system !== 'object' || Array.isArray(raw.system)) throw new Error('Supply a prepared D&D5e character system object.');
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > 80) throw new Error('Supply 1–80 prepared character items.');
  checkTree(raw);
  if (JSON.stringify(raw).length > 400000) throw new Error('Prepared character exceeds 400 KB.');
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const value = raw.system.abilities?.[key]?.value;
    if (!Number.isInteger(value) || value < 1 || value > 30) throw new Error(`Supply the final ${key} score (1–30).`);
  }
  let level = 0;
  for (const item of raw.items) {
    exact(item, ['name', 'type', 'system']);
    string(item.name, 120, 'item name');
    if (!ITEM_TYPES.has(item.type)) throw new Error('Only D&D character Item types are permitted.');
    if (!item.system || typeof item.system !== 'object' || Array.isArray(item.system)) throw new Error('Every item needs prepared system data.');
    if (item.type === 'class') {
      if (!Number.isInteger(item.system.levels) || item.system.levels < 1 || item.system.levels > 20) throw new Error('Class levels must be 1–20.');
      level += item.system.levels;
    }
  }
  if (level < 1 || level > 20) throw new Error('Total PC level must be 1–20.');
  if (raw.system.details?.level !== undefined || raw.system.details?.originalClass !== undefined) throw new Error('Level is derived from class items; originalClass is assigned automatically.');
  const hp = raw.system.attributes?.hp;
  if (!Number.isInteger(hp?.value) || hp.value < 1 || hp.value > 1000) throw new Error('Supply prepared current HP (1–1000).');
  if (hp.max !== undefined && hp.max !== null && (!Number.isInteger(hp.max) || hp.max < hp.value || hp.max > 1000)) throw new Error('Invalid maximum HP.');
  if (raw.portraitPath !== undefined && !/^ai-portraits\/[a-z0-9][a-z0-9_-]{0,79}--[a-f0-9]{12}\.png$/.test(raw.portraitPath)) throw new Error('Portrait must be an uploaded named ai-portraits PNG.');
  return {requestId, name, system: raw.system, items: raw.items, ...(raw.portraitPath ? {portraitPath: raw.portraitPath} : {}), level};
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}

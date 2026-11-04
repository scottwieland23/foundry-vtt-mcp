import {CATEGORIES, searchArgs, entryArgs, pcArgs, canonical} from './creation-policy.mjs';
const ID = 'ai-portrait-bridge';
const categoryFor = c => Object.keys(CATEGORIES).find(k => CATEGORIES[k].includes(c));
export function decodeIndex(raw) {
  if (!Array.isArray(raw.x) || !raw.m || raw.x.length > 200000) throw new Error('Unsupported Plutonium index format.');
  const lookup = Object.fromEntries(Object.entries(raw.m).map(([key, entries]) => [key, Object.fromEntries(Object.entries(entries).map(([name, id]) => [id, name]))]));
  return raw.x.filter(d => d.h && categoryFor(d.c)).map(d => ({...d, s: lookup.s?.[d.s] ?? d.s, t: lookup.t?.[d.t] ?? d.t}));
}
export function makeCreationHandlers({requireGM, requireWrites, serialize}) {
  let indexPromise;
  function requirePlutonium() {
    requireGM();
    if (!game.modules.get('plutonium')?.active) throw new Error('Enable Plutonium in this world first.');
    if (!globalThis.DataLoader?.pCacheAndGet || !globalThis.UrlUtil?.categoryToHoverPage) throw new Error('Plutonium has not finished loading its data API.');
  }
  async function index() {
    requirePlutonium();
    if (!indexPromise) indexPromise = (async () => {
      // Fixed same-origin metadata file. No caller URLs and no full content preload.
      const response = await fetch(new URL('modules/plutonium/search/index-foundry.json', document.baseURI), {credentials: 'same-origin'});
      if (!response.ok) throw new Error('Could not read Plutonium search metadata.');
      const reader = response.body.getReader(); let length = 0; const parts = [];
      try {
        for (;;) { const {value, done} = await reader.read(); if (done) break;
          length += value.byteLength; if (length > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('Plutonium search metadata exceeds 16 MiB.'); } parts.push(value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return decodeIndex(JSON.parse(new TextDecoder().decode(bytes)));
    })().catch(error => { indexPromise = null; throw error; });
    return indexPromise;
  }
  function blocked(row) {
    const prop = globalThis.Parser?.pageCategoryToProp?.(row.c);
    return !!globalThis.ExcludeUtil?.isExcluded?.(row.u, prop, row.s, {isNoCount: true});
  }
  function summary(row) { return {entryId: row.id, name: row.n, category: categoryFor(row.c), source: row.s, ...(row.p ? {page: row.p} : {})}; }
  async function search(raw) {
    requireGM(); const args = searchArgs(raw); const query = args.query.toLowerCase();
    const matches = (await index()).filter(row => (args.category === 'all' || CATEGORIES[args.category].includes(row.c)) &&
      (!args.source || String(row.s).toLowerCase() === args.source.toLowerCase()) && row.n.toLowerCase().includes(query) && !blocked(row));
    matches.sort((a, b) => Number(b.n.toLowerCase() === query) - Number(a.n.toLowerCase() === query) || a.n.localeCompare(b.n) || String(a.s).localeCompare(String(b.s)));
    return {query: args.query, total: matches.length, offset: args.offset, results: matches.slice(args.offset, args.offset + args.limit).map(summary),
      nextOffset: args.offset + args.limit < matches.length ? args.offset + args.limit : null, scope: 'Installed Plutonium index; no bulk content imported.'};
  }
  async function getEntry(raw) {
    requireGM(); const args = entryArgs(raw); const row = (await index()).find(row => row.id === args.entryId);
    if (!row || blocked(row)) throw new Error('Entry is unavailable. Search again after a module update.');
    const page = UrlUtil.categoryToHoverPage(row.c);
    const entity = await DataLoader.pCacheAndGet(page, row.s, row.u, {isCopy: true});
    if (!entity) throw new Error('Plutonium could not load this entry from its configured data source.');
    if (categoryFor(row.c) === 'item' && globalThis.Renderer?.item?.isExcluded?.(entity, {hash: row.u})) throw new Error('This item is excluded in Plutonium.');
    const selected = {};
    for (const key of ['name', 'source', 'level', 'school', 'cr', 'size', 'type', 'ac', 'hp', 'speed', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'rarity', 'prerequisite', 'className', 'subclassShortName', 'edition', 'ability', 'skillProficiencies', 'languageProficiencies', 'toolProficiencies', 'weaponProficiencies', 'armorProficiencies', 'savingThrowProficiencies', 'startingProficiencies', 'hd', 'feats', 'additionalSpells', 'raceName', 'classFeatures', 'subclassFeatures', 'resist', 'immune', 'conditionImmune', 'spellcasting', 'dmg1', 'dmg2', 'dmgType', 'property', 'range', 'weight', 'value', 'time', 'duration', 'components', 'entries', 'entry', 'feature', 'action', 'bonus', 'reaction', 'legendary']) {
      if (entity[key] !== undefined) selected[key] = entity[key];
    }
    const details = JSON.stringify(selected);
    return {...summary(row), details: details.slice(0, args.maxCharacters), truncated: details.length > args.maxCharacters, totalCharacters: details.length};
  }
  async function createPC(raw) {
    requireWrites(); const args = pcArgs(raw);
    if (game.system.id !== 'dnd5e') throw new Error('PC creation currently supports D&D5e only.');
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(args)));
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
    return serialize(async () => {
      requireWrites();
      let actor = Array.from(game.actors).find(a => a.flags?.[ID]?.pcCreation?.requestId === args.requestId);
      const reused = !!actor;
      if (actor && actor.flags[ID].pcCreation.fingerprint !== fingerprint) throw new Error('requestId belongs to a different PC build. Nothing was changed.');
      if (!actor) {
        if (Array.from(game.actors).some(a => a.name.trim().toLowerCase() === args.name.toLowerCase())) throw new Error('An actor already has this name. Choose a unique name.');
        if (args.portraitPath) {
          const files = await foundry.applications.apps.FilePicker.implementation.browse('data', 'ai-portraits');
          if (!files.files?.includes(args.portraitPath)) throw new Error('Upload the portrait before assigning it.');
        }
        let folder = Array.from(game.folders).find(f => f.type === 'Actor' && f.name === 'Player Characters' && !f.folder);
        if (!folder) folder = await CONFIG.Folder.documentClass.create({name: 'Player Characters', type: 'Actor'});
        const items = structuredClone(args.items).map(item => ({...item, _id: foundry.utils.randomID()}));
        const system = structuredClone(args.system); system.details ??= {};
        system.details.originalClass = items.find(i => i.type === 'class')._id;
        const race = items.find(i => i.type === 'race'), background = items.find(i => i.type === 'background');
        if (race) system.details.race = race._id;
        if (background) system.details.background = background._id;
        actor = await CONFIG.Actor.documentClass.create({name: args.name, type: 'character', folder: folder.id, system, items,
          ...(args.portraitPath ? {img: args.portraitPath} : {}), ownership: {default: 0},
          prototypeToken: {actorLink: true, disposition: 1, width: 1, height: 1, texture: {scaleX: 1, scaleY: 1, ...(args.portraitPath ? {src: args.portraitPath} : {})}},
          flags: {[ID]: {pcCreation: {requestId: args.requestId, fingerprint}}}}, {renderSheet: false, keepEmbeddedIds: true});
        if (!actor) throw new Error('PC creation was cancelled. Retry with the same requestId.');
      }
      if (actor.type !== 'character' || actor.system.details.level !== args.level || !Number.isFinite(actor.system.attributes.hp.max) || actor.system.attributes.hp.max < 1) throw new Error(`Actor ${actor.id} exists but its class levels or hit points need inspection. Retry with the same requestId. No actor or scene was deleted.`);
      return {success: true, actorId: actor.id, name: actor.name, level: actor.system.details.level, reused,
        hp: {value: actor.system.attributes.hp.value, max: actor.system.attributes.hp.max}, ac: actor.system.attributes.ac.value,
        itemCount: actor.items.size, placedToken: false, playerAssigned: false,
        notes: 'Saved a prepared build. Random concepts and choices are selected by the assistant before this call. Advancement dialogs are not run; review imported choices and later level-ups. No scenes modified.'};
    });
  }
  return {search, getEntry, createPC};
}

// Shared, dependency-free policy enforced by both sides of the bridge.
export const FOLDER = 'ai-portraits';
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_EDGE = 4096;
export const MAX_PIXELS = 4096 * 4096;
export const MAP_FOLDER = 'ai-maps';
export const MAP_LIMITS = Object.freeze({maxBytes: 25 * 1024 * 1024, maxEdge: 8192, maxPixels: 8192 * 8192});
export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unexpected field: ${key}`);
}

export function validateLocalName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.png$/.test(name)) {
    throw new Error('Use a plain PNG filename from the configured local artwork folder; paths are not allowed.');
  }
  return name;
}

export function validateHash(hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid SHA-256 hash.');
  return hash;
}

export function portraitPath(hash, fileName) {
  validateHash(hash);
  if (fileName === undefined) return `${FOLDER}/${hash}.png`; // Existing uploads remain assignable.
  const stem = validateLocalName(fileName).slice(0, -4).toLowerCase().replace(/_+/g, '-').slice(0, 80).replace(/-+$/, '');
  return `${FOLDER}/${stem}--${hash.slice(0, 12)}.png`;
}

export function validatePortraitPath(path) {
  if (typeof path !== 'string' || !/^ai-portraits\/(?:[a-f0-9]{64}|[a-z0-9][a-z0-9_-]{0,79}--[a-f0-9]{12})\.png$/.test(path)) {
    throw new Error('Artwork must be a named, versioned PNG directly inside ai-portraits.');
  }
  return path;
}

export function mapPath(hash, fileName) {
  validateLocalName(fileName);
  return portraitPath(hash, fileName).replace(/^ai-portraits\//, `${MAP_FOLDER}/`);
}

export function validateMapPath(path) {
  if (typeof path !== 'string' || !/^ai-maps\/[a-z0-9][a-z0-9_-]{0,79}--[a-f0-9]{12}\.png$/.test(path)) {
    throw new Error('Map artwork must be a named, versioned PNG directly inside ai-maps.');
  }
  return path;
}

export function validateSceneMapArgs(args, setting = false) {
  exactKeys(args, setting ? ['sceneId', 'levelId', 'path'] : ['sceneId']);
  if (typeof args.sceneId !== 'string' || !/^[A-Za-z0-9]{16}$/.test(args.sceneId)) throw new Error('Invalid scene ID.');
  if (setting) {
    validateMapPath(args.path);
    if (args.levelId !== undefined && (typeof args.levelId !== 'string' || !/^[A-Za-z0-9]{16}$/.test(args.levelId))) throw new Error('Invalid level ID.');
  }
  return args;
}

export function validateCreateSceneArgs(args) {
  exactKeys(args, ['requestId', 'name', 'path', 'width', 'height', 'gridSize', 'gridDistance', 'gridUnits', 'gridType', 'padding']);
  if (typeof args.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(args.requestId)) throw new Error('Supply a stable 16–64 character requestId for safe retries.');
  if (typeof args.name !== 'string' || !args.name.trim() || args.name.trim().length > 120 || /[\u0000-\u001f<>]/.test(args.name)) throw new Error('Supply a plain scene name of 1–120 characters.');
  validateMapPath(args.path);
  for (const key of ['width', 'height']) if (!Number.isInteger(args[key]) || args[key] < 1 || args[key] > 8192) throw new Error(`${key} must be an integer between 1 and 8192.`);
  const result = {requestId: args.requestId, name: args.name.trim(), path: args.path, width: args.width, height: args.height,
    gridSize: args.gridSize ?? 100, gridDistance: args.gridDistance ?? 5, gridUnits: args.gridUnits ?? 'ft', gridType: args.gridType ?? 1, padding: args.padding ?? 0.25};
  if (!Number.isInteger(result.gridSize) || result.gridSize < 20 || result.gridSize > 1000) throw new Error('gridSize must be an integer between 20 and 1000 pixels.');
  if (!Number.isFinite(result.gridDistance) || result.gridDistance <= 0 || result.gridDistance > 10000) throw new Error('Invalid gridDistance.');
  if (typeof result.gridUnits !== 'string' || !/^[A-Za-z]{1,16}$/.test(result.gridUnits)) throw new Error('Use short alphabetic gridUnits, such as ft or m.');
  if (![0, 1].includes(result.gridType)) throw new Error('gridType must be 0 (gridless) or 1 (square).');
  if (!Number.isFinite(result.padding) || result.padding < 0 || result.padding > 0.5 || Math.abs(result.padding * 20 - Math.round(result.padding * 20)) > 1e-8) throw new Error('padding must be 0–0.5 in steps of 0.05.');
  return result;
}

export function validatePng(bytes, limits) {
  const maxBytes = limits?.maxBytes ?? MAX_BYTES;
  const maxEdge = limits?.maxEdge ?? MAX_EDGE;
  const maxPixels = limits?.maxPixels ?? MAX_PIXELS;
  if (!(bytes instanceof Uint8Array) || bytes.length < 45 || bytes.length > maxBytes) {
    throw new Error(`PNG must be between 45 bytes and ${maxBytes / 1024 / 1024} MiB.`);
  }
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error('Only PNG image data is accepted.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width, height, sawData = false, sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) throw new Error('Truncated PNG chunk.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) throw new Error('PNG must start with IHDR.');
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (!width || !height || width > maxEdge || height > maxEdge || width * height > maxPixels) {
        throw new Error(`PNG dimensions must be between 1 and ${maxEdge} pixels per side.`);
      }
    } else if (type === 'IHDR') throw new Error('Duplicate PNG header.');
    if (type === 'IDAT') sawData = true;
    if (type === 'acTL') throw new Error('Animated PNGs are not supported.');
    offset += length + 12;
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length) throw new Error('PNG has trailing data or an invalid ending.');
      sawEnd = true;
      break;
    }
  }
  if (!sawData || !sawEnd) throw new Error('Incomplete PNG image.');
  return {width, height, bytes: bytes.length};
}

export function decodePayload(base64, decode, limits) {
  const maxBytes = limits?.maxBytes ?? MAX_BYTES;
  if (typeof base64 !== 'string' || base64.length > Math.ceil(maxBytes / 3) * 4 || base64.length % 4 !== 0) {
    throw new Error('Invalid or oversized base64 image payload.');
  }
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  const body = padding ? base64.slice(0, -padding) : base64;
  if (/[^A-Za-z0-9+/]/.test(body)) {
    throw new Error('Invalid or oversized base64 image payload.');
  }
  const bytes = decode(base64);
  validatePng(bytes, limits);
  return bytes;
}

export function validateArtworkArgs(args) {
  exactKeys(args, ['actorId', 'path', 'updatePrototype', 'updateSceneTokens', 'sceneId']);
  if (typeof args.actorId !== 'string' || !/^[A-Za-z0-9]{16}$/.test(args.actorId)) throw new Error('Invalid actor ID.');
  validatePortraitPath(args.path);
  for (const key of ['updatePrototype', 'updateSceneTokens']) {
    if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key} must be boolean.`);
  }
  if (args.sceneId !== undefined && (typeof args.sceneId !== 'string' || !/^[A-Za-z0-9]{16}$/.test(args.sceneId))) {
    throw new Error('Invalid scene ID.');
  }
  return {...args, updatePrototype: args.updatePrototype ?? true, updateSceneTokens: args.updateSceneTokens ?? false};
}

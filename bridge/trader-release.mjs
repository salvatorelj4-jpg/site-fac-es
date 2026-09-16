import crypto from 'node:crypto';

export const KNOWN_TRADERS = Object.freeze(['skad', 'yanov', 'bandit', 'duty', 'merc']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const CLASSNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_+-]{0,127}$/;
const TARGET_RE = /^\/instance\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.json$/;

export function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(value)).digest('hex').toUpperCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function validateTraderSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.traders)) throw new Error('TRADER_SNAPSHOT_INVALID');
  const ids = new Set();
  for (const trader of snapshot.traders) {
    if (!trader || typeof trader.traderId !== 'string' || !KNOWN_TRADERS.includes(trader.traderId) || ids.has(trader.traderId)) throw new Error('TRADER_UNKNOWN_OR_DUPLICATE');
    ids.add(trader.traderId);
    if (!Array.isArray(trader.items)) throw new Error('TRADER_ITEMS_INVALID');
    const classes = new Set();
    for (const item of trader.items) {
      if (!item || typeof item.className !== 'string' || !CLASSNAME_RE.test(item.className) || classes.has(item.className)) throw new Error('CLASSNAME_INVALID_OR_DUPLICATE');
      classes.add(item.className);
      for (const field of ['enabled', 'buyEnabled', 'sellEnabled']) if (typeof item[field] !== 'boolean') throw new Error('TRADER_FLAG_INVALID');
      for (const field of ['buyPrice', 'sellPrice']) if (!Number.isFinite(Number(item[field])) || Number(item[field]) < 0) throw new Error('TRADER_PRICE_INVALID');
    }
  }
  return snapshot;
}

export function validateTargetRegistry(registry) {
  if (!registry || typeof registry !== 'object') throw new Error('REAL_TRADER_SOURCE_UNRESOLVED');
  for (const [traderId, target] of Object.entries(registry)) {
    if (!KNOWN_TRADERS.includes(traderId) || !target || typeof target.path !== 'string' || target.path.includes('..') || target.path.includes('\\') || !TARGET_RE.test(target.path) || target.format !== 'json-array-v1') throw new Error('REAL_TRADER_TARGET_UNRESOLVED');
  }
  return registry;
}

export function exportTraderRelease({ snapshot, targetRegistry, releaseId, createdBy, previousReleaseId = null, createdAt = new Date().toISOString() }) {
  validateTraderSnapshot(snapshot);
  validateTargetRegistry(targetRegistry);
  if (typeof releaseId !== 'string' || !ID_RE.test(releaseId)) throw new Error('RELEASE_ID_INVALID');
  const files = [];
  for (const trader of snapshot.traders) {
    const target = targetRegistry[trader.traderId];
    const body = canonicalJson({ schemaVersion: 1, format: target.format, traderId: trader.traderId, items: trader.items });
    files.push({ traderId: trader.traderId, path: target.path, sha256: sha256(body), size: Buffer.byteLength(body), body });
  }
  return { schemaVersion: 1, releaseId, createdAt, createdBy: String(createdBy || 'unknown'), previousReleaseId, traders: snapshot.traders.map(t => t.traderId), files };
}

export function validateReleasePayload(release) {
  if (!release || !ID_RE.test(release.releaseId) || !Array.isArray(release.files)) throw new Error('RELEASE_PAYLOAD_INVALID');
  const paths = new Set();
  for (const file of release.files) {
    if (!KNOWN_TRADERS.includes(file.traderId) || !TARGET_RE.test(file.path) || paths.has(file.path)) throw new Error('RELEASE_PATH_INVALID');
    paths.add(file.path);
    if (sha256(file.body) !== file.sha256 || Buffer.byteLength(file.body) !== Number(file.size)) throw new Error('RELEASE_SHA256_INVALID');
  }
  return release;
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('.');
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'database.db');
const CATALOG_PATH = path.resolve(process.env.SKAD_CATALOG_PATH || 'data/oblivion-v16-catalog.json');
const BACKUP_DIR = path.join(DATA_DIR, 'oblivion-control', 'skad-migrations');
const SAFE_COLUMNS = ['id', 'trader_id', 'item_name', 'classname', 'category', 'enabled', 'buy_enabled', 'sell_enabled', 'buy_price', 'sell_price', 'stock_mode', 'stock', 'reputation_required', 'max_quantity', 'source_of_truth', 'photo', 'notes', 'created_by', 'created_at', 'updated_at'];

const openDb = (file) => new Promise((resolve, reject) => { const db = new sqlite3.Database(file, (error) => error ? reject(error) : resolve(db)); });
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve(this); }));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
const asError = (code, message = code) => Object.assign(new Error(message), { code });
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function atomicWrite(file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await fs.promises.open(temporary, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(temporary, file);
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await fs.promises.unlink(temporary); } catch {}
    throw error;
  }
}

function catalogRows(catalogFile = CATALOG_PATH) {
  const document = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const offers = document.offers?.filter((offer) => offer.traderId === 'skad') || [];
  const names = offers.map((offer) => offer.classname);
  if (offers.length !== 345 || new Set(names).size !== 345 || offers.some((offer) => offer.enabled || offer.buyEnabled || offer.sellEnabled || Number(offer.buyPrice) !== 0 || Number(offer.sellPrice) !== 0)) throw asError('SKAD_CATALOG_INVALID');
  return offers.map((offer) => ({ trader_id: 'skad', item_name: offer.itemName || offer.classname, classname: offer.classname, category: offer.category, enabled: 0, buy_enabled: 0, sell_enabled: 0, buy_price: 0, sell_price: 0, stock_mode: 'infinite', stock: -1, reputation_required: 0, max_quantity: 1, source_of_truth: 'OWNER_CATALOG_IMPORT', photo: '', notes: offer.notes || '' }));
}

async function readRows(db, traderId = 'skad') { return all(db, `SELECT ${SAFE_COLUMNS.join(',')} FROM oblivion_trader_rules WHERE trader_id=? ORDER BY id`, [traderId]); }
async function otherTraderFingerprint(db) { return hash(await all(db, `SELECT ${SAFE_COLUMNS.join(',')} FROM oblivion_trader_rules WHERE trader_id<>? ORDER BY trader_id,id`, ['skad'])); }
function comparable(row) { return [row.trader_id, row.item_name, row.classname, row.category, Number(row.enabled), Number(row.buy_enabled), Number(row.sell_enabled), Number(row.buy_price), Number(row.sell_price), row.stock_mode, Number(row.stock), Number(row.reputation_required), Number(row.max_quantity), row.source_of_truth, row.photo || '', row.notes || '']; }
function alreadyMatches(current, desired) { return current.length === desired.length && new Set(current.map((row) => row.classname)).size === desired.length && current.every((row, index) => JSON.stringify(comparable(row)) === JSON.stringify(comparable(desired[index]))); }
function insertParams(row) { return SAFE_COLUMNS.filter((column) => column !== 'id').map((column) => row[column] ?? null); }
const insertSql = `INSERT INTO oblivion_trader_rules (${SAFE_COLUMNS.filter((column) => column !== 'id').join(',')}) VALUES (${SAFE_COLUMNS.filter((column) => column !== 'id').map(() => '?').join(',')})`;
const insertWithIdSql = `INSERT INTO oblivion_trader_rules (${SAFE_COLUMNS.join(',')}) VALUES (${SAFE_COLUMNS.map(() => '?').join(',')})`;

export async function migrate({ dbPath = DB_PATH, catalogPath = CATALOG_PATH, backupPath } = {}) {
  const desired = catalogRows(catalogPath);
  const db = await openDb(dbPath);
  try {
    const current = await readRows(db);
    if (alreadyMatches(current, desired)) return { SKAD_ROWS_CHANGED: 0, SKAD_ITEMS: 345, DUPLICATES: 0, backupPath: null };
    const beforeOther = await otherTraderFingerprint(db);
    const targetBackup = backupPath || path.join(BACKUP_DIR, `skad-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await atomicWrite(targetBackup, { schemaVersion: 1, traderId: 'skad', createdAt: new Date().toISOString(), columns: SAFE_COLUMNS, rows: current });
    await run(db, 'BEGIN IMMEDIATE');
    try {
      await run(db, "DELETE FROM oblivion_trader_rules WHERE trader_id='skad'");
      for (const row of desired) await run(db, insertSql, insertParams(row));
      const finalRows = await readRows(db);
      const afterOther = await otherTraderFingerprint(db);
      if (finalRows.length !== 345 || new Set(finalRows.map((row) => row.classname)).size !== 345 || finalRows.some((row) => row.enabled || row.buy_enabled || row.sell_enabled || Number(row.buy_price) !== 0 || Number(row.sell_price) !== 0) || beforeOther !== afterOther) throw asError('SKAD_VALIDATION_FAILED');
      await run(db, 'COMMIT');
      return { SKAD_ROWS_CHANGED: current.length + 345, SKAD_ITEMS: 345, DUPLICATES: 0, backupPath: targetBackup };
    } catch (error) { try { await run(db, 'ROLLBACK'); } catch {} throw error; }
  } finally { await close(db); }
}

export async function rollback({ dbPath = DB_PATH, backupPath } = {}) {
  if (!backupPath) throw asError('BACKUP_REQUIRED');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (backup.traderId !== 'skad' || !Array.isArray(backup.rows)) throw asError('BACKUP_INVALID');
  const db = await openDb(dbPath);
  try {
    await run(db, 'BEGIN IMMEDIATE');
    try {
      await run(db, "DELETE FROM oblivion_trader_rules WHERE trader_id='skad'");
      for (const row of backup.rows) await run(db, insertWithIdSql, SAFE_COLUMNS.map((column) => row[column] ?? null));
      const restored = await readRows(db);
      if (hash(restored) !== hash(backup.rows)) throw asError('ROLLBACK_VALIDATION_FAILED');
      await run(db, 'COMMIT');
      return { restoredRows: restored.length, traderId: 'skad' };
    } catch (error) { try { await run(db, 'ROLLBACK'); } catch {} throw error; }
  } finally { await close(db); }
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}`) {
  const args = new Map(process.argv.slice(2).map((value, index, values) => value.startsWith('--') ? [value, values[index + 1]] : [value, true]));
  const operation = args.get('--rollback') ? rollback({ dbPath: args.get('--db') || DB_PATH, backupPath: args.get('--rollback') }) : migrate({ dbPath: args.get('--db') || DB_PATH, catalogPath: args.get('--catalog') || CATALOG_PATH, backupPath: args.get('--backup') });
  operation.then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
}

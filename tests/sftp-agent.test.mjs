import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWLIST, SftpBridgeAgent, TARGET_KEYS, safeRemotePath, sha256 } from '../bridge/sftp-agent.mjs';

const token = 'x'.repeat(48);
const baseline = Object.fromEntries(ALLOWLIST.map((key) => [`/instance/OblivionControl/${key}`, Buffer.from(`old:${key}`)]));
const content = Object.fromEntries(ALLOWLIST.map((key) => [key, Buffer.from(`new:${key}`)]));
const manifest = { files: ALLOWLIST.map((fileKey) => ({ targetKey: Object.entries(TARGET_KEYS).find(([, relative]) => relative === fileKey)?.[0], releasePath: fileKey, size: content[fileKey].length, sha256: sha256(content[fileKey]) })) };

class MockSftp {
  constructor(seed = baseline) { this.files = new Map(Object.entries(seed).map(([k, v]) => [k, Buffer.from(v)])); this.ops = []; this.failRenameAt = null; this.renameCount = 0; }
  async connect() { this.ops.push(['connect']); }
  async end() { this.ops.push(['end']); }
  async exists(p) { return p === '/instance' || this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(`${p}/`)); }
  async mkdir(p) { this.ops.push(['mkdir', p]); }
  async list(p) { this.ops.push(['list', p]); return [...this.files.keys()].filter((k) => k.startsWith(`${p}/`)).map((name) => ({ name })); }
  async get(p) { if (!this.files.has(p)) throw new Error(`ENOENT:${p}`); return Buffer.from(this.files.get(p)); }
  async put(data, p) { this.ops.push(['put', p]); this.files.set(p, Buffer.from(data)); }
  async rename(from, to) { this.renameCount += 1; this.ops.push(['rename', from, to]); if (this.failRenameAt === this.renameCount) throw new Error('INJECTED_RENAME_FAILURE'); this.files.set(to, this.files.get(from)); this.files.delete(from); }
  async delete(p) { this.ops.push(['delete', p]); this.files.delete(p); }
}

function mockFetch({ badHash = false } = {}) {
  return async (url, options = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/releases/latest')) return { ok: true, json: async () => ({ releaseId: 'rel-1' }) };
    if (u.pathname.endsWith('/manifest')) return { ok: true, json: async () => badHash ? { files: manifest.files.map((x, i) => i === 0 ? { ...x, sha256: 'BAD' } : x) } : manifest };
    if (u.pathname.includes('/files/')) { const key = decodeURIComponent(u.pathname.split('/files/')[1]); const relative = Object.hasOwn(TARGET_KEYS, key) ? TARGET_KEYS[key] : key; return { ok: true, arrayBuffer: async () => content[relative] }; }
    if (u.pathname.endsWith('/heartbeat')) return { ok: true, json: async () => ({ ok: true, body: JSON.parse(options.body) }) };
    throw new Error(`UNEXPECTED_FETCH:${u.pathname}`);
  };
}

function agent(transport, extra = {}) { return new SftpBridgeAgent({ apiBase: 'https://example.test', token, transport, fetchImpl: mockFetch(), ...extra }); }

test('SFTP connect and remote root discovery', async () => { const t = new MockSftp(); const result = await agent(t).connect(); assert.equal(result.instanceExists, true); assert.equal(result.root, '/instance/OblivionControl'); });
test('allowlist and traversal are fail-closed', async () => { assert.throws(() => new SftpBridgeAgent({ apiBase: 'x', token, transport: new MockSftp(), remoteRoot: '/instance/../evil', fetchImpl: mockFetch() }), /REMOTE_ROOT_INVALID|REMOTE_ROOT_OUTSIDE_INSTANCE/); assert.throws(() => safeRemotePath('/instance/OblivionControl', '../evil.json'), /REMOTE_PATH_NOT_ALLOWLISTED/); assert.throws(() => safeRemotePath('/instance/OblivionControl', 'players.db'), /REMOTE_PATH_NOT_ALLOWLISTED/); });
test('apply creates backup, uploads tmp, validates SHA and renames atomically', async () => { const t = new MockSftp(); const result = await agent(t).applyLatest(); assert.equal(result.status, 'APPLIED'); assert.equal(t.files.get('/instance/OblivionControl/Catalog/items.json').toString(), 'new:Catalog/items.json'); assert.ok(t.files.has('/instance/OblivionControl/.backups/rel-1/manifest.json')); assert.ok(t.ops.some((x) => x[0] === 'rename')); });
test('remote SHA mismatch prevents writes', async () => { const t = new MockSftp(); const a = new SftpBridgeAgent({ apiBase: 'https://example.test', token, transport: t, fetchImpl: mockFetch({ badHash: true }) }); await assert.rejects(() => a.applyLatest(), /RELEASE_FILE_SHA256_MISMATCH/); assert.equal(t.ops.filter((x) => x[0] === 'put').length, 0); });
test('partial failure rolls back already changed files byte-for-byte', async () => { const t = new MockSftp(); t.failRenameAt = 2; await assert.rejects(() => agent(t).applyLatest(), /INJECTED_RENAME_FAILURE/); for (const [p, data] of Object.entries(baseline)) assert.deepEqual(t.files.get(p), data); });
test('rollback restores byte-for-byte from remote backup', async () => { const t = new MockSftp(); const a = agent(t); await a.applyLatest(); assert.equal(t.files.get('/instance/OblivionControl/TradeSystem/prices.json').toString(), 'new:TradeSystem/prices.json'); const result = await a.rollback('rel-1'); assert.equal(result.status, 'ROLLED_BACK'); for (const [p, data] of Object.entries(baseline)) assert.deepEqual(t.files.get(p), data); });
test('dry run performs no JSON writes', async () => { const t = new MockSftp(); const a = agent(t, { dryRun: true }); const before = new Map([...t.files].map(([k, v]) => [k, v.toString()])); const result = await a.applyLatest(); assert.equal(result.mode, 'DRY_RUN'); assert.equal(t.ops.filter((x) => ['put', 'rename', 'delete'].includes(x[0])).length, 0); assert.deepEqual(new Map([...t.files].map(([k, v]) => [k, v.toString()])), before); });

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const posix = path.posix;

export const ALLOWLIST = Object.freeze([
  'Catalog/items.json',
  'TradeSystem/traders.json',
  'TradeSystem/categories.json',
  'TradeSystem/prices.json',
  'Economy/economy.json',
  'Reputation/reputation.json',
  'NPCs/npcs.json'
]);
export const TARGET_KEYS = Object.freeze({
  'oblivion-control-catalog': 'Catalog/items.json',
  'oblivion-control-traders': 'TradeSystem/traders.json',
  'oblivion-control-categories': 'TradeSystem/categories.json',
  'oblivion-control-prices': 'TradeSystem/prices.json',
  'oblivion-control-economy': 'Economy/economy.json',
  'oblivion-control-reputation': 'Reputation/reputation.json',
  'oblivion-control-npcs': 'NPCs/npcs.json'
});

const asBuffer = (value) => Buffer.isBuffer(value) ? value : Buffer.from(value);
const sha256 = (value) => crypto.createHash('sha256').update(asBuffer(value)).digest('hex').toUpperCase();
const responseJson = async (response) => {
  if (!response?.ok) throw new Error(`OBC_API_HTTP_${response?.status ?? 'UNKNOWN'}`);
  return response.json();
};

const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const STATE_STATUSES = new Set(['IDLE', 'APPLIED', 'APPLIED_HEARTBEAT_PENDING', 'ROLLED_BACK', 'ROLLED_BACK_HEARTBEAT_PENDING']);

export function validateReleaseId(value) {
  if (typeof value !== 'string' || !RELEASE_ID_RE.test(value) || value.includes('%') || value.includes('\0')) throw new Error('RELEASE_ID_INVALID');
  return value;
}

function normalizeFingerprint(value) {
  if (Buffer.isBuffer(value)) return `SHA256:${crypto.createHash('sha256').update(value).digest('base64')}`;
  return String(value || '').trim();
}

export class PersistentStateStore {
  constructor({ filePath, serverId }) {
    this.filePath = filePath || path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : process.cwd(), 'oblivion-control', 'sftp-bridge-state.json');
    this.serverId = serverId;
  }

  load() {
    if (!fs.existsSync(this.filePath)) return { serverId: this.serverId, currentReleaseId: null, status: 'IDLE', lastApplyAt: null, lastRollbackAt: null };
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { throw new Error('SFTP_STATE_CORRUPT'); }
    if (!parsed || parsed.serverId !== this.serverId || !STATE_STATUSES.has(parsed.status) || (parsed.currentReleaseId != null && (() => { try { validateReleaseId(parsed.currentReleaseId); return false; } catch { return true; } })())) throw new Error('SFTP_STATE_CORRUPT');
    return { serverId: this.serverId, currentReleaseId: parsed.currentReleaseId ?? null, status: parsed.status, lastApplyAt: parsed.lastApplyAt ?? null, lastRollbackAt: parsed.lastRollbackAt ?? null };
  }

  async save(state) {
    const safe = { serverId: this.serverId, currentReleaseId: state.currentReleaseId ?? null, status: state.status, lastApplyAt: state.lastApplyAt ?? null, lastRollbackAt: state.lastRollbackAt ?? null };
    if (!STATE_STATUSES.has(safe.status) || (safe.currentReleaseId != null && !RELEASE_ID_RE.test(safe.currentReleaseId))) throw new Error('SFTP_STATE_INVALID');
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.tmp`;
    await fs.promises.mkdir(directory, { recursive: true });
    let handle;
    try {
      handle = await fs.promises.open(temporary, 'w');
      await handle.writeFile(`${JSON.stringify(safe, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(temporary, this.filePath);
    } catch (error) {
      try { await handle?.close(); } catch {}
      try { await fs.promises.unlink(temporary); } catch {}
      throw error;
    }
  }
}

export function normalizeRemoteRoot(value = process.env.OBC_QONZER_REMOTE_ROOT || '/instance/OblivionControl') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error('REMOTE_ROOT_INVALID');
  }
  const root = posix.normalize(value).replace(/\/$/, '');
  if (root !== '/instance/OblivionControl' && !root.startsWith('/instance/OblivionControl/')) throw new Error('REMOTE_ROOT_OUTSIDE_INSTANCE');
  return root;
}

export function safeRemotePath(root, relative) {
  const normalizedRoot = normalizeRemoteRoot(root);
  if (!ALLOWLIST.includes(relative)) throw new Error('REMOTE_PATH_NOT_ALLOWLISTED');
  return `${normalizedRoot}/${relative}`;
}

export async function createSsh2SftpTransport() {
  let SftpClient;
  try { ({ default: SftpClient } = await import('ssh2-sftp-client')); }
  catch { throw new Error('SFTP_CLIENT_DEPENDENCY_MISSING'); }
  const client = new SftpClient();
  return {
    connect: (config) => client.connect(config),
    end: () => client.end(),
    exists: (remote) => client.exists(remote),
    mkdir: (remote, recursive = true) => client.mkdir(remote, recursive),
    list: (remote) => client.list(remote),
    stat: (remote) => client.stat(remote),
    get: (remote) => client.get(remote),
    put: (data, remote) => client.put(data, remote),
    rename: (from, to) => client.rename(from, to),
    delete: (remote) => client.delete(remote)
  };
}

export class SftpBridgeAgent {
  constructor({
    apiBase = process.env.OBC_API_BASE,
    token = process.env.OBC_BRIDGE_TOKEN,
    serverId = process.env.OBC_SERVER_ID || 'oblivion-production',
    remoteRoot = process.env.OBC_QONZER_REMOTE_ROOT || '/instance/OblivionControl',
    dryRun = String(process.env.OBC_SFTP_DRY_RUN).toLowerCase() === 'true',
    transport,
    fetchImpl = globalThis.fetch,
    hostFingerprint = process.env.OBC_QONZER_SFTP_HOST_FINGERPRINT_SHA256,
    stateStore,
    stateFile
  } = {}) {
    if (!apiBase) throw new Error('OBC_API_BASE_REQUIRED');
    if (!token || Buffer.byteLength(token) < 32) throw new Error('OBC_BRIDGE_TOKEN_REQUIRED');
    if (typeof fetchImpl !== 'function') throw new Error('FETCH_REQUIRED');
    this.apiBase = apiBase.replace(/\/$/, '');
    this.token = token;
    this.serverId = serverId;
    this.remoteRoot = normalizeRemoteRoot(remoteRoot);
    this.dryRun = dryRun;
    this.transport = transport;
    this.fetchImpl = fetchImpl;
    this.hostFingerprint = hostFingerprint ? normalizeFingerprint(hostFingerprint) : '';
    this.stateStore = stateStore || new PersistentStateStore({ filePath: stateFile, serverId: this.serverId }).load();
    this.persistentState = stateStore ? null : new PersistentStateStore({ filePath: stateFile, serverId: this.serverId });
    this.connected = false;
    this.hostKeyVerified = false;
    this.applyState = 'IDLE';
  }

  apiHeaders() { return { Authorization: `Bearer ${this.token}`, 'X-OBC-Server-Id': this.serverId }; }

  async connect() {
    if (!this.transport) this.transport = await createSsh2SftpTransport();
    if (!this.hostFingerprint && process.env.NODE_ENV !== 'test') throw new Error('SFTP_HOST_FINGERPRINT_REQUIRED');
    try {
      // Omit hostHash so ssh2 supplies the raw host-key Buffer; we compute the
      // OpenSSH-compatible SHA256:<base64> fingerprint ourselves.
      await this.transport.connect({ host: process.env.OBC_QONZER_SFTP_HOST, port: Number(process.env.OBC_QONZER_SFTP_PORT || 22), username: process.env.OBC_QONZER_SFTP_USERNAME, password: process.env.OBC_QONZER_SFTP_PASSWORD, hostVerifier: (fingerprint) => this.verifyHostKey(fingerprint) });
      this.connected = true;
    } catch (error) {
      this.connected = false;
      try { await this.transport.end?.(); } catch { /* best effort close after partial connect */ }
      throw error;
    }
    const instanceExists = Boolean(await this.transport.exists('/instance'));
    const rootExists = Boolean(await this.transport.exists(this.remoteRoot));
    if (!instanceExists) throw new Error('REMOTE_INSTANCE_NOT_FOUND');
    return { instanceExists, rootExists, root: this.remoteRoot, dryRun: this.dryRun };
  }

  verifyHostKey(actual) {
    const verified = this.hostFingerprint ? normalizeFingerprint(actual) === this.hostFingerprint : process.env.NODE_ENV === 'test';
    this.hostKeyVerified = verified;
    return verified;
  }

  async close() {
    const transport = this.transport;
    this.connected = false;
    if (transport?.end) await transport.end();
  }

  async withConnection(operation) {
    try { await this.connect(); return await operation(); }
    finally { try { await this.close(); } catch { this.connected = false; } }
  }

  async saveState(status, releaseId = null, field = 'lastApplyAt') {
    this.stateStore.serverId = this.serverId;
    this.stateStore.currentReleaseId = releaseId;
    this.stateStore.status = status;
    this.stateStore[field] = new Date().toISOString();
    if (this.persistentState) await this.persistentState.save(this.stateStore);
  }

  async fetchRelease() {
    const latest = await responseJson(await this.fetchImpl(`${this.apiBase}/api/oblivion/releases/latest`, { headers: this.apiHeaders() }));
    const releaseId = latest.releaseId || latest.id || latest.release?.releaseId;
    validateReleaseId(releaseId);
    const manifest = await responseJson(await this.fetchImpl(`${this.apiBase}/api/oblivion/bridge/releases/${encodeURIComponent(releaseId)}/manifest`, { headers: this.apiHeaders() }));
    const entries = manifest.files || manifest.entries;
    if (!Array.isArray(entries) || entries.length !== ALLOWLIST.length) throw new Error('MANIFEST_ALLOWLIST_MISMATCH');
    const files = new Map();
    for (const entry of entries) {
      const relative = TARGET_KEYS[entry.targetKey] || entry.fileKey || entry.path || entry.target;
      if (!ALLOWLIST.includes(relative) || files.has(relative)) throw new Error('MANIFEST_FILE_NOT_ALLOWLISTED');
      const fileKey = entry.targetKey || relative;
      const response = await this.fetchImpl(`${this.apiBase}/api/oblivion/bridge/releases/${encodeURIComponent(releaseId)}/files/${encodeURIComponent(fileKey)}`, { headers: this.apiHeaders() });
      if (!response?.ok) throw new Error(`RELEASE_FILE_HTTP_${response?.status ?? 'UNKNOWN'}`);
      const data = asBuffer(await response.arrayBuffer());
      const digest = sha256(data);
      if (entry.sha256 && digest !== String(entry.sha256).toUpperCase()) throw new Error('RELEASE_FILE_SHA256_MISMATCH');
      if (entry.size != null && data.length !== Number(entry.size)) throw new Error('RELEASE_FILE_SIZE_MISMATCH');
      files.set(relative, { data, sha256: digest, size: data.length });
    }
    return { releaseId, manifest, files };
  }

  async dryRunCheck() {
    if (!this.connected) await this.connect();
    const listing = this.remoteRoot && this.transport.list ? await this.transport.list(this.remoteRoot).catch(() => []) : [];
    return { mode: 'DRY_RUN', root: this.remoteRoot, wouldCreateRoot: !(await this.transport.exists(this.remoteRoot)), listing, writes: 0 };
  }

  async applyLatest() {
    if (this.applyState === 'IN_PROGRESS') throw new Error('APPLY_ALREADY_IN_PROGRESS');
    this.applyState = 'IN_PROGRESS';
    try { return await this.withConnection(() => this._applyLatest()); }
    finally { if (this.applyState === 'IN_PROGRESS') this.applyState = 'IDLE'; }
  }

  async _applyLatest() {
    if (this.dryRun) return this.dryRunCheck();
    const release = await this.fetchRelease();
    validateReleaseId(release.releaseId);
    if (this.stateStore.currentReleaseId === release.releaseId && ['APPLIED', 'APPLIED_HEARTBEAT_PENDING'].includes(this.stateStore.status)) {
      try { await this.heartbeat({ status: 'APPLIED', currentReleaseId: release.releaseId }); return { status: 'ALREADY_APPLIED', releaseId: release.releaseId, writes: 0 }; }
      catch { return { status: 'APPLIED_HEARTBEAT_PENDING', releaseId: release.releaseId, writes: 0 }; }
    }
    const backupRoot = `${this.remoteRoot}/.backups/${release.releaseId}`;
    await this.transport.mkdir(backupRoot, true);
    const backupManifest = {};
    const changed = [];
    const temporary = new Set();
    try {
      for (const relative of ALLOWLIST) {
        const target = safeRemotePath(this.remoteRoot, relative);
        const backup = `${backupRoot}/${relative}`;
        const exists = Boolean(await this.transport.exists(target));
        backupManifest[relative] = { exists };
        if (exists) { await this.transport.mkdir(posix.dirname(backup), true); const previous = asBuffer(await this.transport.get(target)); await this.transport.put(previous, backup); backupManifest[relative].sha256 = sha256(previous); }
      }
      await this.transport.put(Buffer.from(JSON.stringify(backupManifest)), `${backupRoot}/manifest.json`);
      for (const relative of ALLOWLIST) {
        const target = safeRemotePath(this.remoteRoot, relative);
        const temp = `${target}.tmp-${release.releaseId}`;
        temporary.add(temp);
        const file = release.files.get(relative);
        await this.transport.mkdir(posix.dirname(target), true);
        await this.transport.put(file.data, temp);
        const uploaded = asBuffer(await this.transport.get(temp));
        if (uploaded.length !== file.size || sha256(uploaded) !== file.sha256) throw new Error('REMOTE_SHA_VALIDATION_FAILED');
        await this.transport.rename(temp, target);
        temporary.delete(temp);
        changed.push(relative);
      }
    } catch (error) {
      await this.restoreBackup(release.releaseId, changed, backupManifest).catch(() => {});
      throw error;
    } finally {
      for (const temp of temporary) { try { if (await this.transport.exists(temp)) await this.transport.delete(temp); } catch { /* best effort cleanup */ } }
    }
    await this.saveState('APPLIED', release.releaseId, 'lastApplyAt');
    try { await this.heartbeat({ status: 'APPLIED', currentReleaseId: release.releaseId }); }
    catch { await this.saveState('APPLIED_HEARTBEAT_PENDING', release.releaseId, 'lastApplyAt'); return { status: 'APPLIED_HEARTBEAT_PENDING', releaseId: release.releaseId, files: ALLOWLIST.length, backupRoot }; }
    return { status: 'APPLIED', releaseId: release.releaseId, files: ALLOWLIST.length, backupRoot };
  }

  async restoreBackup(releaseId, relatives = ALLOWLIST, manifest) {
    validateReleaseId(releaseId);
    const backupRoot = `${this.remoteRoot}/.backups/${releaseId}`;
    const metadata = manifest || JSON.parse(asBuffer(await this.transport.get(`${backupRoot}/manifest.json`)).toString('utf8'));
    for (const relative of relatives) {
      const target = safeRemotePath(this.remoteRoot, relative);
      const backup = `${backupRoot}/${relative}`;
      const temporary = `${target}.rollback-tmp-${releaseId}`;
      try {
        if (metadata[relative]?.exists) { const data = asBuffer(await this.transport.get(backup)); if (metadata[relative].sha256 && sha256(data) !== metadata[relative].sha256) throw new Error('BACKUP_SHA256_MISMATCH'); await this.transport.put(data, temporary); await this.transport.rename(temporary, target); }
        else if (await this.transport.exists(target)) await this.transport.delete(target);
      } finally { try { if (await this.transport.exists(temporary)) await this.transport.delete(temporary); } catch { /* best effort cleanup */ } }
    }
  }

  async rollback(releaseId) {
    validateReleaseId(releaseId);
    return this.withConnection(() => this._rollback(releaseId));
  }

  async _rollback(releaseId) {
    const backupRoot = `${this.remoteRoot}/.backups/${releaseId}`;
    if (!await this.transport.exists(`${backupRoot}/manifest.json`)) throw new Error('BACKUP_NOT_FOUND');
    await this.restoreBackup(releaseId);
    await this.saveState('ROLLED_BACK', null, 'lastRollbackAt');
    try { await this.heartbeat({ status: 'ROLLED_BACK', rolledBackReleaseId: releaseId }); }
    catch { await this.saveState('ROLLED_BACK_HEARTBEAT_PENDING', null, 'lastRollbackAt'); return { status: 'ROLLED_BACK_HEARTBEAT_PENDING', releaseId }; }
    return { status: 'ROLLED_BACK', releaseId };
  }

  async heartbeat(extra = {}) {
    for (const key of ['currentReleaseId', 'rolledBackReleaseId', 'restoredReleaseId']) if (extra[key] != null) validateReleaseId(extra[key]);
    const response = await this.fetchImpl(`${this.apiBase}/api/oblivion/bridge/heartbeat`, { method: 'POST', headers: { ...this.apiHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ serverId: this.serverId, ...extra }) });
    return responseJson(response);
  }
}

export { sha256 };

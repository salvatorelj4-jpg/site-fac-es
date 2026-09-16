import { SftpBridgeAgent } from './sftp-agent.mjs';

let inFlight = false;

export class AdminSftpDryRunError extends Error {
  constructor(code, status = 503, diagnostic = null) { super(code); this.code = code; this.status = status; this.diagnostic = diagnostic; }
}

const timeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new AdminSftpDryRunError('SFTP_DRY_RUN_TIMEOUT', 504)), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

export async function runAdminSftpDryRun({ env = process.env, createAgent = () => new SftpBridgeAgent({ dryRun: true }), timeoutMs = 30000 } = {}) {
  if (String(env.OBC_SFTP_DRY_RUN).toLowerCase() !== 'true') throw new AdminSftpDryRunError('DRY_RUN_REQUIRED', 503);
  timeoutMs = Number(env.OBC_SFTP_CONNECT_TIMEOUT_MS || timeoutMs || 30000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new AdminSftpDryRunError('CONFIG_INVALID', 503, { stage: 'CONFIG_VALIDATION', hostKeyVerify: 'NOT_REACHED', elapsedMs: 0 });
  if (inFlight) throw new AdminSftpDryRunError('SFTP_DRY_RUN_BUSY', 409);
  inFlight = true;
  let agent;
  try {
    agent = await createAgent();
    const connection = await timeout(agent.connect(), timeoutMs).catch((error) => {
      if (error instanceof AdminSftpDryRunError) {
        const diagnostic = agent?.diagnosticSnapshot?.() || { stage: 'SSH_HANDSHAKE', hostKeyVerify: 'NOT_REACHED', elapsedMs: timeoutMs };
        throw new AdminSftpDryRunError(error.code, error.status, diagnostic);
      }
      const diagnostic = agent?.diagnosticSnapshot?.() || { stage: 'SSH_HANDSHAKE', hostKeyVerify: 'NOT_REACHED', elapsedMs: timeoutMs };
      throw new AdminSftpDryRunError(String(error?.code || 'SFTP_DRY_RUN_FAILED'), 502, diagnostic);
    });
    if (agent.hostKeyVerified !== true) throw new AdminSftpDryRunError('HOST_KEY_MISMATCH', 502, agent.diagnosticSnapshot?.());
    if (connection.rootExists === true) {
      agent.diagnosticStart?.('REMOTE_ROOT_LIST');
      await timeout(agent.transport.list(connection.root), timeoutMs);
    }
    agent.diagnosticFinish?.();
    const diagnostic = agent.diagnosticSnapshot?.() || { stages: [], hostKeyVerify: 'PASS', elapsedMs: 0 };
    diagnostic.stage = 'CLOSE';
    return { ok: true, sftpConnect: 'PASS', hostKeyVerify: 'PASS', remoteInstanceFound: connection.instanceExists === true, remoteRoot: connection.root, remoteRootExists: connection.rootExists === true, dryRun: true, writes: 0, backupsCreated: 0, filesChanged: 0, connectionClosed: true, diagnostic };
  } catch (error) {
    if (error instanceof AdminSftpDryRunError) {
      if (!error.diagnostic) error.diagnostic = agent?.diagnosticSnapshot?.() || { stage: 'SSH_HANDSHAKE', hostKeyVerify: 'NOT_REACHED', elapsedMs: timeoutMs };
      throw error;
    }
    const diagnostic = agent?.diagnosticSnapshot?.() || { stage: 'SSH_HANDSHAKE', hostKeyVerify: 'NOT_REACHED', elapsedMs: timeoutMs };
    throw new AdminSftpDryRunError(String(error?.code || 'SFTP_DRY_RUN_FAILED'), 502, diagnostic);
  } finally {
    try { await timeout(Promise.resolve(agent?.close?.()), 3000); } catch {}
    inFlight = false;
  }
}

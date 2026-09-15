import { SftpBridgeAgent } from './sftp-agent.mjs';

let inFlight = false;

export class AdminSftpDryRunError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

const timeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new AdminSftpDryRunError('SFTP_DRY_RUN_TIMEOUT', 504)), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

export async function runAdminSftpDryRun({ env = process.env, createAgent = () => new SftpBridgeAgent({ dryRun: true }), timeoutMs = 15000 } = {}) {
  if (String(env.OBC_SFTP_DRY_RUN).toLowerCase() !== 'true') throw new AdminSftpDryRunError('DRY_RUN_REQUIRED', 503);
  if (inFlight) throw new AdminSftpDryRunError('SFTP_DRY_RUN_BUSY', 409);
  inFlight = true;
  let agent;
  try {
    agent = await createAgent();
    const connection = await timeout(agent.connect(), timeoutMs);
    if (agent.hostKeyVerified !== true) throw new AdminSftpDryRunError('SFTP_DRY_RUN_FAILED', 502);
    if (connection.rootExists === true) await timeout(agent.transport.list(connection.root), timeoutMs);
    return { ok: true, sftpConnect: 'PASS', hostKeyVerify: agent.hostKeyVerified === true ? 'PASS' : 'FAIL', remoteInstanceFound: connection.instanceExists === true, remoteRoot: connection.root, remoteRootExists: connection.rootExists === true, dryRun: true, writes: 0, backupsCreated: 0, filesChanged: 0, connectionClosed: true };
  } catch (error) {
    if (error instanceof AdminSftpDryRunError) throw error;
    throw new AdminSftpDryRunError('SFTP_DRY_RUN_FAILED', 502);
  } finally {
    try { await timeout(Promise.resolve(agent?.close?.()), 3000); } catch {}
    inFlight = false;
  }
}

import { SftpBridgeAgent } from './sftp-agent.mjs';

const result = {
  SFTP_CONNECT: 'FAIL',
  HOST_KEY_VERIFY: 'FAIL',
  REMOTE_INSTANCE_FOUND: 'FAIL',
  REMOTE_ROOT: process.env.OBC_QONZER_REMOTE_ROOT || '/instance/OblivionControl',
  REMOTE_ROOT_EXISTS: 'FAIL',
  DRY_RUN: String(process.env.OBC_SFTP_DRY_RUN).toLowerCase() === 'true' ? 'YES' : 'NO',
  WRITES: 0,
  BACKUPS_CREATED: 0,
  FILES_CHANGED: 0,
  CONNECTION_CLOSED: 'NO'
};

let agent;
try {
  if (String(process.env.OBC_SFTP_DRY_RUN).toLowerCase() !== 'true') throw new Error('DRY_RUN_REQUIRED');
  agent = new SftpBridgeAgent({ dryRun: true });
  const connection = await agent.connect();
  result.SFTP_CONNECT = 'PASS';
  result.HOST_KEY_VERIFY = agent.hostKeyVerified ? 'PASS' : 'FAIL';
  result.REMOTE_INSTANCE_FOUND = connection.instanceExists ? 'PASS' : 'FAIL';
  result.REMOTE_ROOT = connection.root;
  result.REMOTE_ROOT_EXISTS = connection.rootExists ? 'PASS' : 'FAIL';
  // Inventory only; do not call applyLatest, even though the agent is in dry-run mode.
  await agent.transport.list(connection.root);
} catch (error) {
  // Deliberately emit only a stable error code, never connection options or secrets.
  result.ERROR_CODE = String(error?.code || error?.message || 'DRY_RUN_FAILED').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 64);
} finally {
  try { await agent?.close(); } catch {}
  result.CONNECTION_CLOSED = agent?.connected === false ? 'YES' : 'NO';
}

console.log(JSON.stringify(result, null, 2));
if (result.SFTP_CONNECT !== 'PASS' || result.HOST_KEY_VERIFY !== 'PASS' || result.REMOTE_INSTANCE_FOUND !== 'PASS' || result.REMOTE_ROOT_EXISTS !== 'PASS' || result.CONNECTION_CLOSED !== 'YES') process.exitCode = 1;

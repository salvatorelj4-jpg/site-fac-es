import test from 'node:test';
import assert from 'node:assert/strict';
import { SftpBridgeAgent } from '../bridge/sftp-agent.mjs';

function makeAgent(mode) {
  const transport = {
    connect: async (config) => {
      if (mode === 'tcp') throw Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' });
      if (mode === 'host') { config.hostVerifier('SHA256:wrong'); throw new Error('host key verification failed'); }
      if (mode === 'auth') throw Object.assign(new Error('Authentication failure'), { code: 'AUTH_FAILED' });
      config.hostVerifier('SHA256:expected');
    },
    end: async () => {},
    exists: async (remote) => {
      if (mode === 'sftp') throw Object.assign(new Error('sftp subsystem unavailable'), { code: 'SFTP_FAILURE' });
      if (mode === 'remote' && remote !== '/instance') throw new Error('remote path missing');
      return true;
    },
    list: async () => []
  };
  return new SftpBridgeAgent({ apiBase:'https://example.invalid', token:'x'.repeat(32), hostFingerprint:'SHA256:expected', transport, stateStore:{ serverId:'test', currentReleaseId:null, status:'IDLE' } });
}

test('DIAGNOSTIC_STAGE_TCP_TIMEOUT', async () => { const agent=makeAgent('tcp'); await assert.rejects(() => agent.connect(), (e) => e.code === 'TCP_TIMEOUT' && agent.diagnosticSnapshot().stage === 'TCP_CONNECT'); });
test('DIAGNOSTIC_STAGE_HOST_KEY', async () => { const agent=makeAgent('host'); await assert.rejects(() => agent.connect(), (e) => e.code === 'HOST_KEY_MISMATCH' && agent.diagnosticSnapshot().stage === 'HOST_KEY_VERIFY'); });
test('DIAGNOSTIC_STAGE_AUTH', async () => { const agent=makeAgent('auth'); await assert.rejects(() => agent.connect(), (e) => e.code === 'AUTH_FAILED' && agent.diagnosticSnapshot().stage === 'AUTHENTICATION'); });
test('DIAGNOSTIC_STAGE_SFTP', async () => { const agent=makeAgent('sftp'); await assert.rejects(() => agent.connect(), (e) => e.code === 'SFTP_SUBSYSTEM_FAILED' && agent.diagnosticSnapshot().stage === 'SFTP_SUBSYSTEM'); });
test('DIAGNOSTIC_STAGE_REMOTE_PATH', async () => { const agent=makeAgent('remote'); await assert.rejects(() => agent.connect(), (e) => e.code === 'REMOTE_PATH_NOT_FOUND' && agent.diagnosticSnapshot().stage === 'REMOTE_ROOT_STAT'); });
test('SECRETS_NOT_EXPOSED', async () => { const agent=makeAgent('auth'); try { await agent.connect(); } catch (error) { const serialized=JSON.stringify({ code:error.code, diagnostic:agent.diagnosticSnapshot() }); assert.doesNotMatch(serialized, /x{32}|password|token|jwt/i); } });
test('NO_WRITE_OPERATIONS', async () => { const agent=makeAgent('tcp'); const writes=['mkdir','put','rename','delete']; for (const method of writes) assert.equal(typeof agent.transport[method], 'undefined'); });

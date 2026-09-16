import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AdminSftpDryRunError, runAdminSftpDryRun } from '../bridge/admin-sftp-dry-run.mjs';

function mockAgent({ delay = 0, hostKeyVerified = true, closeFail = false } = {}) {
  let closed = false;
  return { get closed() { return closed; }, hostKeyVerified, connect: async () => { if (delay) await new Promise((resolve) => setTimeout(resolve, delay)); return { instanceExists: true, root: '/instance/OblivionControl', rootExists: true }; }, transport: { list: async () => [{ name: 'Catalog' }], mkdir: async () => { throw new Error('WRITE_FORBIDDEN'); }, put: async () => { throw new Error('WRITE_FORBIDDEN'); }, rename: async () => { throw new Error('WRITE_FORBIDDEN'); }, delete: async () => { throw new Error('WRITE_FORBIDDEN'); } }, close: async () => { if (closeFail) throw new Error('CLOSE_FAILED'); closed = true; } };
}

test('admin dry-run requires true and returns sanitized read-only result', async () => { let created = false; await assert.rejects(() => runAdminSftpDryRun({ env: {}, createAgent: () => { created = true; return mockAgent(); } }), (error) => error instanceof AdminSftpDryRunError && error.code === 'DRY_RUN_REQUIRED'); assert.equal(created, false); const result = await runAdminSftpDryRun({ env: { OBC_SFTP_DRY_RUN: 'true' }, createAgent: () => mockAgent() }); assert.deepEqual({ ...result, diagnostic: undefined }, { ok:true,sftpConnect:'PASS',hostKeyVerify:'PASS',remoteInstanceFound:true,remoteRoot:'/instance/OblivionControl',remoteRootExists:true,dryRun:true,writes:0,backupsCreated:0,filesChanged:0,connectionClosed:true,diagnostic:undefined }); assert.equal(result.diagnostic.stage, 'CLOSE'); });
test('timeout is handled and connection is closed', async () => { const agent = mockAgent({ delay: 100 }); await assert.rejects(() => runAdminSftpDryRun({ env: { OBC_SFTP_DRY_RUN: 'true' }, timeoutMs: 5, createAgent: () => agent }), /SFTP_DRY_RUN_TIMEOUT/); await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(agent.closed, true); });
test('concurrent dry-run is rejected and no write methods are called', async () => { let release; const wait = new Promise((resolve) => { release = resolve; }); const agent = { ...mockAgent(), connect: async () => { await wait; return { instanceExists:true,root:'/instance/OblivionControl',rootExists:true }; } }; const first = runAdminSftpDryRun({ env: { OBC_SFTP_DRY_RUN:'true' }, createAgent: () => agent }); await new Promise((resolve) => setImmediate(resolve)); await assert.rejects(() => runAdminSftpDryRun({ env: { OBC_SFTP_DRY_RUN:'true' }, createAgent: () => mockAgent() }), /SFTP_DRY_RUN_BUSY/); release(); await first; });
test('missing remote root is reported without attempting a write', async () => { let listed = false; const agent = mockAgent(); agent.connect = async () => ({ instanceExists:true,root:'/instance/OblivionControl',rootExists:false }); agent.transport.list = async () => { listed = true; return []; }; const result = await runAdminSftpDryRun({ env:{ OBC_SFTP_DRY_RUN:'true' }, createAgent:() => agent }); assert.equal(result.remoteRootExists, false); assert.equal(result.ok, true); assert.equal(listed, false); });
test('host-key verification failure is rejected', async () => { await assert.rejects(() => runAdminSftpDryRun({ env:{ OBC_SFTP_DRY_RUN:'true' }, createAgent:() => mockAgent({ hostKeyVerified:false }) }), /HOST_KEY_MISMATCH/); });
test('CLOSE_SUCCESS_REPORTS_TRUE', async () => { const agent=mockAgent(); const result=await runAdminSftpDryRun({ env:{ OBC_SFTP_DRY_RUN:'true' }, createAgent:()=>agent }); assert.equal(agent.closed,true); assert.equal(result.connectionClosed,true); });
test('CLOSE_FAILURE_REPORTS_FALSE', async () => { const agent=mockAgent({ closeFail:true }); const result=await runAdminSftpDryRun({ env:{ OBC_SFTP_DRY_RUN:'true' }, createAgent:()=>agent }); assert.equal(result.connectionClosed,false); assert.equal(result.code,'SFTP_DRY_RUN_CLOSE_FAILED'); });
test('PRIMARY_ERROR_PRESERVED_WHEN_CLOSE_FAILS', async () => { const agent=mockAgent({ closeFail:true, hostKeyVerified:false }); await assert.rejects(() => runAdminSftpDryRun({ env:{ OBC_SFTP_DRY_RUN:'true' }, createAgent:()=>agent }), (error) => error.code === 'HOST_KEY_MISMATCH' && error.connectionClosed === false); });
test('SUCCESS_WITH_CLOSE_FAILURE_REPORTS_FALSE', async () => { const result=await runAdminSftpDryRun({ env:{ OBC_SFTP_DRY_RUN:'true' }, createAgent:()=>mockAgent({ closeFail:true }) }); assert.equal(result.ok,false); assert.equal(result.connectionClosed,false); });
test('SECRETS_NOT_EXPOSED_ON_CLOSE_ERROR', async () => { const result=await runAdminSftpDryRun({ env:{ OBC_SFTP_DRY_RUN:'true' }, createAgent:()=>mockAgent({ closeFail:true }) }); assert.doesNotMatch(JSON.stringify(result), /password|token|jwt|secret/i); });
test('route remains JWT/capability protected and does not consume browser SFTP fields', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  const routeStart = source.indexOf("app.post('/api/oblivion/admin/sftp-dry-run'");
  assert.notEqual(routeStart, -1);
  const route = source.slice(routeStart, routeStart + 1800);
  assert.match(route, /app\.post\('\/api\/oblivion\/admin\/sftp-dry-run', auth, requireObcCapability\('oblivion:manage'\)/);
  assert.match(route, /runObcAdminSftpDryRun\(\)/);
  assert.doesNotMatch(route, /req\.body\.(host|port|username|password|remoteRoot|fingerprint)/);
});

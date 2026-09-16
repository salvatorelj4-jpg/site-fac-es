import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const panel = fs.readFileSync('public/admin-oblivion-control.html', 'utf8');

test('STRUCTURED_ERROR_PRESERVED', () => {
  assert.match(app, /endpoint === '\/api\/oblivion\/admin\/connection-check'/);
  assert.match(app, /error\.obcSftpDiagnostic/);
  assert.match(app, /connectionClosed/);
});

test('sanitized backend error contains the approved diagnostic fields', () => {
  const handler = server.slice(server.indexOf('async function handleObcAdminSftpDryRun'), server.indexOf("app.post('/api/oblivion/admin/sftp-dry-run'"));
  for (const field of ['code', 'stage', 'elapsedMs', 'hostKeyVerify', 'remoteInstanceFound', 'remoteRoot', 'remoteRootExists', 'connectionClosed']) assert.match(handler, new RegExp(field));
  assert.doesNotMatch(handler, /password|username|authorization|jwt|privateKey|bridgeToken|process\.env/i);
});

test('SFTP_DIAGNOSTIC_HIDDEN_FROM_NORMAL_UI', () => {
  assert.doesNotMatch(panel, /TESTAR CONEXÃO SFTP|sftpDryRunButton|obcSftpDiagnosticText|Dry-run indisponível|Falha sem diagnóstico estruturado/);
  assert.match(panel, /COMÉRCIO &amp; TRADERS/);
  assert.match(panel, /loadTraders\(\)/);
});

test('SECRETS_NOT_RENDERED', () => { assert.doesNotMatch(panel, /password|username|authorization|jwt|token|private.?key|credential/i); });

test('PUBLISH_CREATES_PENDING_RELEASE_AND_API_HELPER_COMPATIBILITY', () => {
  assert.match(panel, /Release criada\. Aguardando sincronização com o servidor DayZ/);
  assert.match(panel, /loadReleases\(\)/);
  assert.match(server, /status:'PENDING_BRIDGE'/);
  assert.match(app, /throw error;/);
  assert.match(app, /return data;/);
});

test('BRIDGE_FAILURE_IS_NON_CRITICAL_IN_NORMAL_UI', () => {
  assert.match(panel, /runtime-status/);
  assert.doesNotMatch(panel, /TESTAR CONEXÃO SFTP|sftpDryRun|bridge.*FAIL|FAIL.*bridge/i);
});

test('PANEL_ONLINE_STATUS_AND_NO_STAGING_BLOCKER_LANGUAGE', () => {
  const central = fs.readFileSync('public/admin.html', 'utf8');
  const overview = fs.readFileSync('public/admin-oblivion.html', 'utf8');
  const commerce = fs.readFileSync('public/admin-commerce.html', 'utf8');
  const rail = fs.readFileSync('public/admin-control.js', 'utf8');
  for (const page of [central, overview]) assert.match(page, /<small>Painel<\/small>/);
  assert.match(central, /runtime-status/);
  assert.match(overview, /runtime-status/);
  assert.doesNotMatch(overview, /Modo staging|bridge ainda não está conectado/);
  assert.doesNotMatch(commerce, /STAGING \/ NÃO APLICADO/);
  assert.doesNotMatch(rail, /modo administrativo \/ staging/);
});

test('BRIDGE_REQUIRES_REAL_HEARTBEAT_FOR_CONNECTED_STATUS', () => {
  assert.match(server, /const runtime = obc\.runtimeStatus\(\)/);
  assert.match(server, /bridgeStatus: runtime\.bridge\.status === 'CONNECTED' \? 'CONNECTED' : 'AGUARDANDO_CONEXAO'/);
  assert.match(fs.readFileSync('public/admin-control.js', 'utf8'), /MOD_INSTALADO/);
});

test('NO_REMOTE_WRITES', () => {
  const route = server.slice(server.indexOf('async function handleObcAdminSftpDryRun'), server.indexOf("app.post('/api/oblivion/admin/sftp-dry-run'"));
  assert.doesNotMatch(route, /applyLatest|\.mkdir\(|\.put\(|\.rename\(|\.delete\(/);
});

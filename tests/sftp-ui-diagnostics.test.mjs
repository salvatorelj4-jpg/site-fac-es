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

test('UI_SHOWS_ERROR_CODE_STAGE_ELAPSED_MS_AND_CONNECTION_CLOSED', () => {
  assert.match(panel, /obcSftpDiagnosticText/);
  assert.match(panel, /Código:/);
  assert.match(panel, /Etapa:/);
  assert.match(panel, /Tempo:/);
  assert.match(panel, /Conexão fechada:/);
});

test('SECRETS_NOT_RENDERED', () => {
  const renderer = panel.slice(panel.indexOf('function obcSftpDiagnosticText'), panel.indexOf('async function runSftpDryRun'));
  assert.doesNotMatch(renderer, /password|username|authorization|jwt|token|private.?key|credential/i);
});

test('SUCCESS_RESPONSE_UNCHANGED_AND_API_HELPER_COMPATIBILITY', () => {
  assert.match(panel, /r\.ok\?'PASS':'FAIL'/);
  assert.match(panel, /r\.remoteRoot/);
  assert.match(app, /throw error;/);
  assert.match(app, /return data;/);
});

test('NO_REMOTE_WRITES', () => {
  const route = server.slice(server.indexOf('async function handleObcAdminSftpDryRun'), server.indexOf("app.post('/api/oblivion/admin/sftp-dry-run'"));
  assert.doesNotMatch(route, /applyLatest|\.mkdir\(|\.put\(|\.rename\(|\.delete\(/);
});

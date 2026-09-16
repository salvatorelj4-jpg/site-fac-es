import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('server.js', 'utf8');

test('POST_ROUTE_REACHABLE', () => {
  assert.match(source, /app\.post\('\/api\/oblivion\/admin\/sftp-dry-run', auth, requireObcCapability\('oblivion:manage'\)/);
  assert.doesNotMatch(source, /Method Not Allowed|status\(405\)/);
});

test('OPTIONS_ROUTE', () => { assert.match(source, /app\.options\('\/api\/oblivion\/admin\/sftp-dry-run'/); });
test('GET_HEALTH_ROUTE', () => { assert.match(source, /app\.get\('\/api\/oblivion\/admin\/sftp-dry-run-health'/); });
test('ROUTE_ORDER', () => {
  const staticIndex = source.indexOf("app.use(express.static(path.join(__dirname, 'public')))");
  const healthIndex = source.indexOf("app.get('/api/oblivion/admin/sftp-dry-run-health'");
  const optionsIndex = source.indexOf("app.options('/api/oblivion/admin/sftp-dry-run'");
  assert.ok(staticIndex > optionsIndex && staticIndex > healthIndex);
  assert.doesNotMatch(source, /app\.use\([^\n]*405|Method Not Allowed/);
});
test('AUTH_FAILURE_NOT_405', () => { const route = source.slice(source.indexOf("app.post('/api/oblivion/admin/sftp-dry-run'")); assert.match(route, /auth, requireObcCapability\('oblivion:manage'\)/); assert.doesNotMatch(route.slice(0, 1800), /status\(405\)/); });
test('NO_SECRETS_IN_TRACE', () => { const trace = source.slice(source.indexOf("app.use('/api/oblivion/admin/sftp-dry-run'"), source.indexOf("app.use(express.static")); assert.match(trace, /method=\$\{req\.method\}/); assert.doesNotMatch(trace, /authorization|password|token|process\.env/i); });
test('NO_REMOTE_WRITES', () => { const route = source.slice(source.indexOf("app.post('/api/oblivion/admin/sftp-dry-run'")); assert.doesNotMatch(route.slice(0, 1800), /applyLatest|\.mkdir\(|\.put\(|\.rename\(|\.delete\(/); });

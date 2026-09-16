import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('server.js', 'utf8');
const panel = fs.readFileSync('public/admin-oblivion-control.html', 'utf8');

test('NEUTRAL_POST_ROUTE', () => { assert.match(source, /app\.post\('\/api\/oblivion\/admin\/connection-check', auth, requireObcCapability\('oblivion:manage'\), handleObcAdminSftpDryRun\)/); });
test('NEUTRAL_OPTIONS_ROUTE', () => { assert.match(source, /app\.options\('\/api\/oblivion\/admin\/connection-check'.*204/); });
test('AUTH_REQUIRED', () => { const route=source.slice(source.indexOf("app.post('/api/oblivion/admin/connection-check'")); assert.match(route, /auth, requireObcCapability\('oblivion:manage'\)/); });
test('CAPABILITY_REQUIRED', () => { assert.match(source, /app\.post\('\/api\/oblivion\/admin\/connection-check', auth, requireObcCapability\('oblivion:manage'\)/); });
test('SAME_HANDLER_USED', () => { const oldRoute=source.match(/app\.post\('\/api\/oblivion\/admin\/sftp-dry-run',[^\n]+/u)?.[0]; const neutralRoute=source.match(/app\.post\('\/api\/oblivion\/admin\/connection-check',[^\n]+/u)?.[0]; assert.match(oldRoute, /handleObcAdminSftpDryRun/); assert.match(neutralRoute, /handleObcAdminSftpDryRun/); assert.equal(source.match(/async function handleObcAdminSftpDryRun/g)?.length, 1); });
test('NO_REMOTE_WRITES', () => { const handler=source.slice(source.indexOf('async function handleObcAdminSftpDryRun'), source.indexOf("app.post('/api/oblivion/admin/sftp-dry-run'")); assert.doesNotMatch(handler, /applyLatest|\.mkdir\(|\.put\(|\.rename\(|\.delete\(/); });
test('SECRETS_NOT_EXPOSED', () => { const trace=source.slice(source.indexOf("app.use('/api/oblivion/admin/connection-check'"), source.indexOf('app.use(express.static')); assert.doesNotMatch(trace, /authorization|cookie|password|token|process\.env/i); assert.doesNotMatch(panel.slice(panel.indexOf('runSftpDryRun'), panel.indexOf('async function loadTraders')), /password|token|fingerprint/i); });
test('OLD_ROUTE_UNCHANGED', () => { assert.match(source, /app\.post\('\/api\/oblivion\/admin\/sftp-dry-run', auth, requireObcCapability\('oblivion:manage'\), handleObcAdminSftpDryRun\)/); });

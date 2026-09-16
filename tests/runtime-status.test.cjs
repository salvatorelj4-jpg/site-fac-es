const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { HEARTBEAT_TTL_MS, computeRuntimeStatus } = require('../bridge/runtime-status.js');

const now = Date.parse('2026-09-15T12:00:00.000Z');

test('NEVER_CONNECTED_STATE', () => {
  const status = computeRuntimeStatus({}, now);
  assert.equal(status.panel, 'ONLINE');
  assert.equal(status.bridge.status, 'NEVER_CONNECTED');
  assert.equal(status.qonzer.status, 'UNKNOWN');
  assert.equal(status.dayzServer.status, 'UNKNOWN');
});

test('REAL_HEARTBEAT_STATUS', () => {
  const status = computeRuntimeStatus({ heartbeatAt: new Date(now - 1000).toISOString(), runtimeHeartbeatAt: new Date(now - 1000).toISOString(), serverOnline: true, modInstalled: true, modLoaded: true, modVersion: '1.6' }, now);
  assert.equal(status.bridge.status, 'CONNECTED');
  assert.equal(status.dayzServer.status, 'ONLINE');
  assert.equal(status.qonzer.status, 'MOD_LOADED');
  assert.equal(status.qonzer.modVersion, '1.6');
});

test('HEARTBEAT_EXPIRY_AND_STALE_STATE', () => {
  const status = computeRuntimeStatus({ heartbeatAt: new Date(now - HEARTBEAT_TTL_MS - 1).toISOString(), runtimeHeartbeatAt: new Date(now - HEARTBEAT_TTL_MS - 1).toISOString(), serverOnline: true, modInstalled: true, modLoaded: true }, now);
  assert.equal(status.bridge.status, 'STALE');
  assert.equal(status.dayzServer.status, 'UNKNOWN');
  assert.equal(status.qonzer.status, 'UNKNOWN');
});

test('NO_FALSE_MOD_NOT_INSTALLED_WITHOUT_RECENT_EVIDENCE', () => {
  assert.equal(computeRuntimeStatus({}, now).qonzer.status, 'UNKNOWN');
  assert.equal(computeRuntimeStatus({ heartbeatAt: new Date(now - 1000).toISOString(), runtimeHeartbeatAt: new Date(now - 1000).toISOString(), serverOnline: true, modInstalled: false, modLoaded: false }, now).qonzer.status, 'MOD_NOT_INSTALLED');
  assert.equal(computeRuntimeStatus({ heartbeatAt: new Date(now - 1000).toISOString(), serverOnline: true, modInstalled: true, modLoaded: true }, now).qonzer.status, 'UNKNOWN');
});

test('WORKSHOP_STATUS_IS_SERVER_CONFIGURED', () => {
  assert.deepEqual(computeRuntimeStatus({}, now).workshop, { status: 'PUBLISHED', id: '3802398240' });
});

test('RUNTIME_STATUS_ENDPOINT_AND_AUTHENTICATED_HEARTBEAT_EXIST', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /app\.get\('\/api\/oblivion\/admin\/runtime-status', auth, requireObcCapability\('oblivion:read'\)/);
  assert.match(server, /app\.post\('\/api\/oblivion\/bridge\/runtime-heartbeat', obcBridgeAuth/);
  assert.doesNotMatch(server, /runtime-heartbeat.*req\.headers\.(authorization|cookie)/i);
  assert.match(server, /const runtime = obc\.runtimeStatus\(\)/);
  assert.match(server, /qonzerStatus: runtime\.qonzer\.status/);
});

test('BROWSER_STATUS_SPOOF_BLOCKED', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/oblivion/bridge/runtime-heartbeat'"), server.indexOf('let obcAdminSftpDryRunRequest'));
  assert.match(route, /obcBridgeAuth/);
  assert.doesNotMatch(route, /req\.body\.(status|connection|heartbeat)/);
});

test('AUTO_REFRESH_UI', () => {
  for (const file of ['public/admin.html', 'public/admin-oblivion.html', 'public/admin-oblivion-control.html']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /runtime-status/);
    assert.match(source, /setInterval\([^,]+,15000\)/);
  }
});

test('POLLING_SINGLE_TIMER_AND_NO_OVERLAP_GUARDS', () => {
  const commerce = fs.readFileSync('public/admin-oblivion-control.html', 'utf8');
  const overview = fs.readFileSync('public/admin-oblivion.html', 'utf8');
  const central = fs.readFileSync('public/admin.html', 'utf8');
  for (const source of [commerce, overview]) {
    assert.match(source, /runtimeStatusTimer=null/);
    assert.match(source, /if\(runtimeStatusTimer\)clearInterval\(runtimeStatusTimer\)/);
    assert.match(source, /runtimeStatusInFlight/);
    assert.match(source, /if\(!runtimeStatusInFlight\)load/);
    assert.match(source, /beforeunload/);
  }
  assert.match(central, /runtimeStatusTimer=null,runtimeStatusInFlight=false/);
  assert.match(central, /if\(!runtimeStatusTimer\)runtimeStatusTimer=setInterval/);
  assert.match(central, /if\(runtimeStatusInFlight\)return/);
});

test('LAST_VALID_STATE_PRESERVED_ON_TEMPORARY_FAILURE', () => {
  const commerce = fs.readFileSync('public/admin-oblivion-control.html', 'utf8');
  const overview = fs.readFileSync('public/admin-oblivion.html', 'utf8');
  const central = fs.readFileSync('public/admin.html', 'utf8');
  for (const source of [commerce, overview, central]) {
    assert.match(source, /lastValidRuntimeStatus/);
    assert.match(source, /DADOS TEMPORARIAMENTE INDISPONÍVEIS/);
  }
  assert.match(commerce, /renderRuntimeStatus\(lastValidRuntimeStatus\|\|/);
  assert.match(overview, /renderRuntimeStatus\(lastValidRuntimeStatus\|\|/);
  assert.match(central, /if\(!lastValidRuntimeStatus\)/);
});

const HEARTBEAT_TTL_MS = 120000;

function computeRuntimeStatus(snapshot = {}, now = Date.now(), workshopId = '3802398240') {
  const timestamp = typeof snapshot.heartbeatAt === 'string' ? Date.parse(snapshot.heartbeatAt) : NaN;
  const runtimeTimestamp = typeof snapshot.runtimeHeartbeatAt === 'string' ? Date.parse(snapshot.runtimeHeartbeatAt) : NaN;
  const age = Number.isFinite(timestamp) ? now - timestamp : null;
  const runtimeAge = Number.isFinite(runtimeTimestamp) ? now - runtimeTimestamp : null;
  const bridgeStatus = !Number.isFinite(timestamp) ? 'NEVER_CONNECTED' : age <= HEARTBEAT_TTL_MS ? 'CONNECTED' : 'STALE';
  const runtimeRecent = Number.isFinite(runtimeTimestamp) && runtimeAge <= HEARTBEAT_TTL_MS;
  const dayzStatus = runtimeRecent && typeof snapshot.serverOnline === 'boolean' ? (snapshot.serverOnline ? 'ONLINE' : 'OFFLINE') : 'UNKNOWN';
  const qonzerStatus = runtimeRecent && snapshot.modInstalled === true && snapshot.modLoaded === true ? 'MOD_LOADED' : runtimeRecent && snapshot.modInstalled === false ? 'MOD_NOT_INSTALLED' : 'UNKNOWN';
  return {
    panel: 'ONLINE',
    bridge: { status: bridgeStatus, lastHeartbeatAt: snapshot.heartbeatAt || null },
    dayzServer: { status: dayzStatus },
    qonzer: { status: qonzerStatus, modVersion: runtimeRecent && typeof snapshot.modVersion === 'string' ? snapshot.modVersion : null },
    workshop: { status: 'PUBLISHED', id: workshopId }
  };
}

module.exports = { HEARTBEAT_TTL_MS, computeRuntimeStatus };

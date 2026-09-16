import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, exportTraderRelease, validateReleasePayload, validateTargetRegistry } from '../bridge/trader-release.mjs';

const registry = Object.freeze({
  bandit: { path: '/instance/OblivionControl/TraderTargets/bandit.json', format: 'json-array-v1' },
  skad: { path: '/instance/OblivionControl/TraderTargets/skad.json', format: 'json-array-v1' }
});
const snapshot = { traders: [{ traderId: 'bandit', items: [{ className: 'Magnum', enabled: true, buyEnabled: true, sellEnabled: true, buyPrice: 100, sellPrice: 120, category: 'weapons' }] }, { traderId: 'skad', items: [{ className: 'Canteen', enabled: false, buyEnabled: false, sellEnabled: false, buyPrice: 0, sellPrice: 0, category: 'survival' }] }] };

test('TRADER_REAL_SOURCE_UNRESOLVED_FAILS_CLOSED', () => assert.throws(() => validateTargetRegistry(), /REAL_TRADER_SOURCE_UNRESOLVED/));
test('EXPORT_SCHEMA_VALID_AND_DETERMINISTIC', () => { const a = exportTraderRelease({ snapshot, targetRegistry: registry, releaseId: 'rel-1', createdBy: 'owner', createdAt: '2026-09-15T00:00:00.000Z' }); const b = exportTraderRelease({ snapshot, targetRegistry: registry, releaseId: 'rel-1', createdBy: 'owner', createdAt: '2026-09-15T00:00:00.000Z' }); assert.deepEqual(a, b); validateReleasePayload(a); });
test('SINGLE_ITEM_CHANGE_ONLY_TOUCHES_INCLUDED_TRADER', () => { const release = exportTraderRelease({ snapshot: { traders: [snapshot.traders[0]] }, targetRegistry: { bandit: registry.bandit }, releaseId: 'rel-2', createdBy: 'owner' }); assert.deepEqual(release.traders, ['bandit']); assert.equal(release.files.length, 1); assert.match(release.files[0].body, /Magnum/); });
test('INVALID_PRICE_DUPLICATE_AND_TRAVERSAL_REJECTED', () => { assert.throws(() => exportTraderRelease({ snapshot: { traders: [{ ...snapshot.traders[0], items: [{ ...snapshot.traders[0].items[0], sellPrice: -1 }] }] }, targetRegistry: { bandit: registry.bandit }, releaseId: 'rel-3' }), /TRADER_PRICE_INVALID/); assert.throws(() => exportTraderRelease({ snapshot, targetRegistry: { ...registry, yanov: { path: '/instance/../evil.json', format: 'json-array-v1' } }, releaseId: 'rel-4' }), /REAL_TRADER_TARGET_UNRESOLVED/); assert.equal(canonicalJson({ b: 1, a: 2 }), '{\n  "a": 2,\n  "b": 1\n}\n'); });

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../bridge/run-sftp-dry-run.mjs', import.meta.url));

test('dry-run runner aborts unless explicitly enabled and emits no secrets', () => {
  for (const value of [undefined, 'false']) {
    const env = { ...process.env, OBC_SFTP_DRY_RUN: value };
    if (value === undefined) delete env.OBC_SFTP_DRY_RUN;
    const child = spawnSync(process.execPath, [runner], { env, encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    const output = `${child.stdout}${child.stderr}`;
    assert.match(output, /DRY_RUN/);
    assert.doesNotMatch(output, /OBC_BRIDGE_TOKEN|OBC_QONZER_SFTP_PASSWORD/);
  }
});

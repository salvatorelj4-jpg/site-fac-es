# OblivionControl V1.7.2 — SFTP bridge

The bridge is an isolated, server-to-server transport for the local/staging phase. It never accepts a browser path. The only remote JSON targets are the seven files in `ALLOWLIST` and the bridge stores release backups below `.backups/<releaseId>`.

## Configuration

Set these only in the Wispbyte environment (never in GitHub, a ZIP, logs, or the browser): `OBC_API_BASE`, `OBC_BRIDGE_TOKEN`, `OBC_SERVER_ID`, `OBC_QONZER_SFTP_HOST`, `OBC_QONZER_SFTP_PORT`, `OBC_QONZER_SFTP_USERNAME`, `OBC_QONZER_SFTP_PASSWORD`, and `OBC_QONZER_REMOTE_ROOT=/instance/OblivionControl`. `OBC_SFTP_DRY_RUN=true` connects and inventories only; it performs no JSON writes.

Apply downloads the release through the authenticated bridge API, validates manifest size and SHA-256, snapshots the current remote bytes, uploads a release-specific temporary file, validates it, and atomically renames it. Any failure restores files already changed. Rollback restores the exact backup bytes and emits a heartbeat. Real credentials and Qonzer are intentionally not exercised by this change.

## Local validation

Run `node --test tests/sftp-agent.test.mjs` and `node --check server.js`. The tests use an in-memory SFTP fixture and cover discovery, allowlist/traversal rejection, backup, temporary upload, atomic rename, SHA validation, partial-failure rollback, byte-for-byte rollback, and dry-run no-write behavior.

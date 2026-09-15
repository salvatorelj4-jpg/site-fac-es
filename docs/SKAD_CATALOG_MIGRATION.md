# Skad catalog migration (345 owner items)

This migration is separate from `initDb` seed behavior. It changes only rows whose `trader_id` is `skad` in `oblivion_trader_rules`; it does not clear a table or touch users, permissions, drafts, releases, bridge state, uploads, or other traders.

## Dry local execution

Use a local/staging database only:

```text
node tools/migrate-skad-catalog.mjs --db <local-database.db> --backup <skad-backup.json>
```

The migration validates the 345-item source, writes a logical JSON backup before opening the SQLite transaction, deletes/reinserts only Skad rows, validates count/uniqueness/disabled zero-price state and non-Skad fingerprints, then commits. Any validation failure rolls back. A second run returns `SKAD_ROWS_CHANGED: 0`.

Rollback is explicit and row-for-row:

```text
node tools/migrate-skad-catalog.mjs --db <local-database.db> --rollback <skad-backup.json>
```

The migration is not invoked by production startup and must not be run against Wispbyte/Qonzer without a separate owner gate. The existing seed remains for a new/empty OBC table; populated installations require this explicit migration.

# Live trader integration audit

## Evidence boundary

This repository contains the OblivionControl control-plane database mappings (`skad`, `yanov`, `bandit`, `duty`, `merc`) and the local control path `/instance/OblivionControl`. It does not contain the Qonzer mission, Workshop PBOs, or the third-party trader source files. No real trader target path or file format is therefore inferred.

| Field | Result |
|---|---|
| TRADER_SYSTEM | `REMOTE_VALIDATION_REQUIRED` |
| REAL_TRADER_CONFIG_PATH | `BLOCKED — not present in this repository` |
| TRADER_FILE_FORMAT | `BLOCKED — must be confirmed from the installed trader mod/mission` |
| RELOAD_REQUIREMENT | `UNKNOWN — do not restart or hot-reload automatically` |
| NPC_MAPPING | `STATIC mapping only: entity class in OBC database; runtime source not verified` |

## Safe implementation boundary

`bridge/trader-release.mjs` provides deterministic export and strict validation once an owner-approved registry supplies an evidence-backed target path and format. It rejects missing registries, unknown traders, traversal, duplicate paths, duplicate classnames, invalid prices, and malformed flags. The default bridge remains limited to the existing `/instance/OblivionControl` allowlist; it does not write a real trader file.

Before a live apply, the registry must be populated from a read-only audit of the actual Qonzer instance and reviewed by the owner. A first test should include one item and one trader only, with a captured backup and an explicit rollback.

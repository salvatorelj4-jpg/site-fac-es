# Admin SFTP dry-run action

The existing admin JWT session can invoke `POST /api/oblivion/admin/sftp-dry-run` with `oblivion:manage` (or `super_admin`). The request body is ignored; all SFTP settings remain server-side environment variables.

The action requires `OBC_SFTP_DRY_RUN=true`, validates the pinned host key, checks `/instance` and `/instance/OblivionControl`, lists the root, and closes the connection. It never calls `applyLatest` or any write operation. A process-local lock rejects concurrent requests and a bounded timeout returns a sanitized error. The admin panel exposes this as **TESTAR CONEXÃO SFTP** with `IDLE`, `RUNNING`, `PASS`, and `FAIL` states.

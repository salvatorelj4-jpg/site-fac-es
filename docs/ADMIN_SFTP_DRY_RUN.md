# Admin SFTP dry-run action

The existing admin JWT session can invoke `POST /api/oblivion/admin/sftp-dry-run` with `oblivion:manage` (or `super_admin`). The request body is ignored; all SFTP settings remain server-side environment variables.

The action requires `OBC_SFTP_DRY_RUN=true`, validates the pinned host key, checks `/instance` and `/instance/OblivionControl`, lists the root, and closes the connection. Host, port, credentials, fingerprint, and remote root are read only from server-side environment variables; request-body values are ignored. It never calls `applyLatest` or any write operation. A process-local lock rejects concurrent requests and a bounded timeout returns a sanitized error. The timeout defaults to 30 seconds in production and can be set with `OBC_SFTP_CONNECT_TIMEOUT_MS`.

Failures return only a sanitized code and diagnostic stage (`CONFIG_VALIDATION`, `TCP_CONNECT`, `SSH_HANDSHAKE`, `HOST_KEY_VERIFY`, `AUTHENTICATION`, `SFTP_SUBSYSTEM`, `INSTANCE_STAT`, `REMOTE_ROOT_STAT`, `REMOTE_ROOT_LIST`, or `CLOSE`) with timestamps and elapsed durations. Credentials, tokens, JWTs, and stack traces are never returned. The admin panel exposes this as **TESTAR CONEXÃO SFTP** with `IDLE`, `RUNNING`, `PASS`, and `FAIL` states.

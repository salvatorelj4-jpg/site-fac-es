# SFTP dry-run HTTP 405 diagnostic

The server now exposes a safe `GET /api/oblivion/admin/sftp-dry-run-health` endpoint and explicit `OPTIONS /api/oblivion/admin/sftp-dry-run` handling. The health response contains only the build identifier, supported method list, and the boolean dry-run flag.

Requests reaching the local Express process emit only:

```text
OBC_SFTP_HTTP_TRACE timestamp=<iso> method=<method> path=/api/oblivion/admin/sftp-dry-run routeReached=true
```

No authorization header, JWT, password, token, or environment value is logged. The local smoke check returns POST `401` without credentials, OPTIONS `204`, and health `200`; a valid POST is therefore not rejected as `405` by Express. If production still returns `405` and no trace appears, investigate the Wispbyte reverse proxy, stale process/build, or an upstream method policy. If the trace appears but the response is `405`, inspect the live process/build mismatch or an upstream response rewrite.

# SFTP production dry-run runner

The Wispbyte process remains `server.js`; this is an explicit, read-only CLI operation:

```text
npm run obc:sftp:dry-run
```

It refuses to start unless `OBC_SFTP_DRY_RUN=true`, pins the configured SHA-256 host fingerprint, verifies `/instance` and `/instance/OblivionControl`, lists the remote root, then closes SFTP. It never calls `applyLatest`, `mkdir`, `put`, `rename`, `delete`, backup, or migration code. Output contains only sanitized status fields; passwords and bridge tokens are never printed.

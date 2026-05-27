# Data Model: T078 — Master Key Rotation

## No new entities

This feature adds no new tables or columns. All entities are existing.

## Entities modified by the re-key tool

### `supabase_instances.encrypted_secrets` (existing)
- AES-256-GCM blob containing `InstanceSecrets` JSON (13 fields: jwtSecret, anonKey, serviceRoleKey, postgresPassword, dashboardPassword, secretKeyBase, vaultEncKey, logflarePublicAccessToken, logflarePrivateAccessToken, pgMetaCryptoKey, s3ProtocolAccessKeyId, s3ProtocolAccessKeySecret, minioRootPassword)
- Re-keyed in-place: same column, new ciphertext (new IV + new tag)
- PK: `ref` (text)

### `project_config_snapshots.encrypted_payload` (existing)
- AES-256-GCM blob containing runtime config JSON per surface (`postgrest` | `auth` | `postgres`)
- PK: `id` (uuid)

### `project_secrets.encrypted_value` (existing)
- AES-256-GCM blob containing per-project vault secret value
- Nullable: No — all rows have a value
- PK: `id` (uuid)

### `users.backup_store_config_encrypted` (existing)
- AES-256-GCM blob containing S3 backup config JSON; **nullable** — only set when user has configured a backup store
- PK: `id` (uuid)

### `tls_accounts.account_key_pem` (existing)
- AES-256-GCM blob wrapping `{ pem: string }` JSON — ACME account private key PEM
- PK: `id` (uuid)

### `tls_certs.key_pem` (existing)
- AES-256-GCM blob wrapping `{ pem: string }` JSON — per-domain TLS cert private key; **nullable**
- PK: `id` (uuid)

### `pg_edge_certs.key_pem` (existing)
- AES-256-GCM blob wrapping `{ pem: string }` JSON — PG edge proxy TLS cert private key; **nullable**
- PK: `id` (uuid)

## Blob wire format (all tables)

```
[ iv: 12 bytes ][ ciphertext: variable ][ auth-tag: 16 bytes ]
```

Total minimum length: 28 bytes. The re-key tool validates length before attempting decryption.

## State transitions

```
OLD_KEY-encrypted blob  →(decrypt with OLD_KEY)→  plaintext  →(encrypt with NEW_KEY)→  NEW_KEY-encrypted blob
```

Atomically committed for all rows. Rollback restores all rows to OLD_KEY-encrypted state.

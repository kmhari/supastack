# @supastack/backup-store

Pluggable backup destination.

```ts
interface BackupStore {
  put(ref: string, stream: Readable): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  list(ref: string): Promise<BackupRef[]>;
  signedUrl?(key: string, expiresInSec: number): Promise<string>;
}
```

Two implementations:

- **`LocalDiskStore({ root })`** — writes `<root>/<ref>/<timestamp>.dump`
  with mode 0600. Directory-traversal-safe. Used when
  `org.backup_store_kind = 'local'`.
- **`S3Store({ endpoint?, bucket, region, accessKeyId, secretAccessKey })`**
  — `@aws-sdk/client-s3` multipart upload + `getSignedUrl`. Works against
  AWS S3, MinIO, Cloudflare R2, Backblaze B2 (anything S3-compatible).
  Used when `org.backup_store_kind = 's3'`.

## Switching stores

`PUT /api/v1/org/backup-store` accepts a discriminated union. The S3 config
(including `secretAccessKey`) is encrypted with `MASTER_KEY` before being
written to `org.backup_store_config_encrypted`.

## Tests

```sh
pnpm --filter @supastack/backup-store test
```

`LocalDiskStore` round-trip + traversal safety is unit-tested. S3 tests
would need `@aws-sdk/client-mock` or a MinIO container; not yet wired up.

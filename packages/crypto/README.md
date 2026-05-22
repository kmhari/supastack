# @selfbase/crypto

Crypto primitives for selfbase. Five surfaces:

| Module         | Purpose                                                                                                           | Used by                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `aes-gcm.ts`   | AES-256-GCM `encrypt`/`decrypt` + json wrappers + `loadMasterKey` (fail-fast at boot)                             | `apps/api` (per-instance secret blob, SMTP password, S3 config), `apps/worker` (decrypt for provision/backup) |
| `argon2.ts`    | `hashPassword` / `verifyPassword` (Argon2id, OWASP-recommended params)                                            | `apps/api` (user passwords, invite acceptance)                                                                |
| `jwt.ts`       | `signSupabaseJwt` / `verifySupabaseJwt` (HS256)                                                                   | `apps/api` (mints per-instance `anon_key` and `service_role_key`)                                             |
| `passwords.ts` | `generatePassword` (alphanumeric only) + `assertSafeForEnv` (rejects `$`, backtick, quote, backslash, whitespace) | `apps/api` (instance secrets), `packages/docker-control` (env validation)                                     |
| `ref.ts`       | `generateRef` / `isValidRef` (20 lowercase alphanumerics, Supabase Cloud format)                                  | `apps/api` (instance creation)                                                                                |

## Critical contracts

- `loadMasterKey()` throws if `MASTER_KEY` is missing or malformed. **The API
  and worker MUST call this at startup and refuse to boot on failure.**
- `signSupabaseJwt(secret, { role })` returns a token that VERIFIES against the
  same `secret`. Anti-SupaConsole regression — asserted in `tests/crypto.test.ts`.
- `generatePassword()` only emits characters from `[A-Za-z0-9]`. Anti-Multibase
  regression — 1000 samples asserted in `tests/crypto.test.ts`.

## Tests

```sh
pnpm --filter @selfbase/crypto test
```

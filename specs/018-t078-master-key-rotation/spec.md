# Feature Specification: T078 — Master Key Rotation Regression Test

**Feature Branch**: `018-t078-master-key-rotation`

**Created**: 2026-05-27

**Status**: Draft

**Input**: Post-deploy validation from issue #54 (feature 014), T078 acceptance.

> **Context**: All per-project sensitive data in supastack (Postgres passwords, JWT secrets, API keys, TLS private keys, backup credentials, runtime config) is encrypted at rest using AES-256-GCM with a single operator-controlled master key. If that key is ever compromised or rotated as a security practice, every encrypted blob in the control-plane database must be re-encrypted with the new key before the platform can continue operating. Currently there is no tooling for this, and the rotation has never been validated. T078 closes that gap by building a re-key tool and proving it works end-to-end: after rotation, a project can be paused and restored and comes back up cleanly with all secrets intact.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator rotates the master key without downtime (Priority: P1)

As an operator, I want to be able to replace the master encryption key with a new one and have all running and future projects continue working correctly, so that I can respond to a key-compromise incident or fulfil a routine key-rotation policy without manual per-project recovery.

**Why this priority**: This is the core safety requirement. Without it, a compromised key means the operator has no recovery path. Every other story depends on this working.

**Independent Test**: Run the re-key tool against the test VM database, swap `MASTER_KEY` in the environment, restart the api and worker, call `GET /v1/projects/:ref/api-keys` on a pre-existing project and confirm the anon key and service-role key are returned correctly (proving `encrypted_secrets` decrypted with the new key).

**Acceptance Scenarios**:

1. **Given** the platform is running with an existing master key and N projects with encrypted secrets, **When** the operator runs the re-key tool with `OLD_MASTER_KEY` and `NEW_MASTER_KEY`, **Then** all blobs are re-encrypted in a single atomic transaction and the tool reports the count of rotated rows with no errors.
2. **Given** the re-key tool completes successfully, **When** the operator updates `MASTER_KEY` in the environment and restarts the api and worker, **Then** the api starts without errors and responds to health checks.
3. **Given** the environment has been updated to the new key, **When** the operator requests the API keys for any pre-existing project, **Then** the correct anon and service-role keys are returned (proving the secrets blob decrypts with the new key).
4. **Given** the re-key tool is run with an incorrect `OLD_MASTER_KEY`, **When** it attempts to decrypt any blob, **Then** the transaction is rolled back, no data is modified, and the tool exits with a clear error identifying the mismatch.

---

### User Story 2 — Operator validates rotation via pause/restore (Priority: P2)

As an operator, I want to pause and restore a project immediately after a master-key rotation, so that I can confirm the full container-lifecycle path (which exercises `encrypted_secrets` to reconstruct container env vars) works with the new key before signing off on the rotation.

**Why this priority**: `GET /api-keys` only tests read-path decryption. Pause/restore exercises the write path — the worker decrypts secrets, injects them as Docker Compose env vars, and brings up every container. This is the most complete end-to-end signal.

**Independent Test**: After US1 completes, pick any project on the test VM, pause it via the dashboard or API, wait for `status = inactive`, then restore it, wait for `status = active`, and confirm all per-project containers (kong, auth, db, rest, realtime, storage) are `healthy` in `docker ps`.

**Acceptance Scenarios**:

1. **Given** a project is running and the master key has been rotated (US1 complete), **When** the operator pauses the project, **Then** the project reaches `status = inactive` without errors in the api or worker logs.
2. **Given** the project is paused, **When** the operator restores it, **Then** the project reaches `status = active`, all per-project containers come up healthy, and no "decryption failed" or "MASTER_KEY" errors appear in api or worker logs.
3. **Given** the project is restored and healthy, **When** the operator makes an authenticated request through the project's kong gateway, **Then** the request succeeds (proving the restored containers received correct env vars derived from the re-encrypted secrets).

---

### Edge Cases

- **Partial re-key failure**: If the transaction is interrupted mid-run (network drop, OOM), no blobs must be partially updated — the transaction guarantee ensures the database is either fully rotated or fully unchanged.
- **Nullable encrypted columns**: Some columns (`backup_store_config_encrypted`, `tls_certs.key_pem`, `pg_edge_certs.key_pem`) are nullable. The tool must skip NULL rows without error and correctly report only non-null rows rotated.
- **Incorrect old key**: If `OLD_MASTER_KEY` doesn't match any blob's encryption, AES-GCM tag verification fails. The tool must catch this on the first failure, roll back, and exit with an actionable error — not silently corrupt data.
- **Same old and new key**: Running the tool with identical keys is a no-op in terms of security but must not corrupt data. The tool should warn the operator but complete successfully.
- **Re-key run twice with same parameters**: If the operator runs the tool a second time after already rotating, the first arg is now wrong — the tool correctly fails on tag mismatch. The operator must supply the current (already-rotated) key as `OLD_MASTER_KEY`.
- **Large number of secrets rows**: Projects with many vault secrets generate many `project_secrets` rows. The transaction must not time out for realistic row counts (< 10,000 rows expected on the test VM).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The re-key tool MUST atomically re-encrypt all encrypted blobs across all affected tables in a single database transaction — either all rows are updated or none are.
- **FR-002**: The re-key tool MUST verify each re-encrypted blob round-trips correctly (decrypt with new key) before writing, so a faulty new key is caught before commit.
- **FR-003**: The re-key tool MUST support a dry-run mode that reports the count of rows that would be rotated per table, without writing any changes.
- **FR-004**: The re-key tool MUST handle nullable encrypted columns gracefully, skipping NULL rows without error.
- **FR-005**: The re-key tool MUST produce structured output lines per table (rows rotated, table name) and a final PASS/FAIL summary so the operator can audit without re-running.
- **FR-006**: After re-key completes, the operator MUST be able to restart the api and worker with the new key and have the platform come up without errors.
- **FR-007**: After restart, a project pause followed by restore MUST complete successfully — all per-project containers reach healthy status and serve authenticated requests.
- **FR-008**: The re-key tool and procedure MUST be documented so a future operator can execute the rotation without tribal knowledge.

### Key Entities

- **Master key**: The 256-bit AES key stored as `MASTER_KEY` env var on the VM. All encrypted blobs are sealed with this key.
- **Encrypted blob**: Any `bytea` column holding AES-256-GCM ciphertext. Format: `iv (12 bytes) || ciphertext || auth-tag (16 bytes)`.
- **Re-key transaction**: The atomic DB operation that decrypts each blob with the old key and re-encrypts it with the new key. Must be a single transaction across all affected tables.
- **Rotation outcome record**: Structured log output from the re-key tool listing per-table row counts and final PASS/FAIL, retained as evidence that T078 was validated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The re-key tool completes without error on the test VM and reports the correct count of rotated rows across all 7 affected tables (verified by cross-checking against `SELECT COUNT(*)` on each table before the run).
- **SC-002**: After key swap and api/worker restart, `GET /v1/projects/:ref/api-keys` returns the correct credentials for every pre-existing project (no decryption errors).
- **SC-003**: A project pause + restore cycle completes successfully after rotation — all containers reach healthy status within the normal provisioning window (≤ 5 minutes).
- **SC-004**: The dry-run mode produces the same row counts as the live run without making any database changes (verified by running dry-run, then live run, and comparing reported counts).
- **SC-005**: The rotation procedure is documented with enough detail that an operator who has never seen the codebase can execute it correctly by following the runbook alone.
- **SC-006**: Issue #54's T078 acceptance checkbox is closeable: rotation procedure validated on the test VM and outcome documented.

## Assumptions

- **Test VM is the target**: The supastack VM at `supaviser.dev` is confirmed as a non-production test environment. All validation runs against this VM.
- **Re-key tool already exists**: `scripts/rekey-master.mjs` was written as part of this feature's implementation work (pre-spec). The spec validates the procedure and documents it; the tool code is already in place on the feature branch.
- **Single atomic transaction is feasible**: Row counts on the test VM are small enough (< a few hundred rows across all tables) that a single transaction completes well within Postgres default statement timeout.
- **Operator has direct DB access**: The re-key tool connects directly to the control-plane Postgres via `DATABASE_URL`. The operator can obtain this value from the VM's `.env` file.
- **Project pause/restore API is functional**: The pause/restore endpoints shipped in feature 014 and are already live on the test VM.
- **No live traffic during rotation**: T078 is a scheduled maintenance operation. The spec assumes the operator runs the re-key tool during a low-traffic or zero-traffic window to avoid in-flight requests failing due to key mismatch.

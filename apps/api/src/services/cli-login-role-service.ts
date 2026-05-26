/**
 * CLI login-role rotation service (feature 012).
 *
 * Implements the per-project Postgres side of the upstream
 *   POST   /v1/projects/:ref/cli/login-role
 *   DELETE /v1/projects/:ref/cli/login-role
 * endpoints. Each successful POST idempotently provisions a persistent
 * per-project login role (`cli_login_postgres` or
 * `cli_login_supabase_read_only_user`) on the per-instance Postgres, then
 * rotates that role's password to a fresh 256-bit value with
 *   VALID UNTIL now() + interval '5 minutes'.
 *
 * The upstream `supabase` CLI binary's AfterConnect callback
 * (`apps/cli-go/internal/utils/connect.go:215-220`) detects any username
 * with the `cli_login_` prefix and runs `SET SESSION ROLE <target>`
 * automatically — privilege escalation happens at runtime, not at
 * role-creation time. We therefore create the roles with NOINHERIT and rely
 * on `IN ROLE <target>` membership for the SET ROLE to succeed.
 *
 * SQL pattern matches upstream's `apps/cli-go/internal/utils/flags/queries/role.sql`
 * (verified against PR #3885, merged 2025-07-21):
 *
 *   do $func$
 *   begin
 *     if not exists (select 1 from pg_roles where rolname = '<role>') then
 *       create role "<role>" noinherit login noreplication in role <target>;
 *     end if;
 *     execute format(
 *       $$alter role "<role>" with password '<password>' valid until %L$$,
 *       now() + interval '5 minutes'
 *     );
 *   end
 *   $func$ language plpgsql;
 *
 * Concurrency: every endpoint call wraps the role-ensure + ALTER ROLE in a
 * single transaction guarded by `pg_advisory_xact_lock(hashtext($key))`
 * where $key is `${ref}:${rw|ro}`. Two simultaneous calls for the same
 * (project, scope) serialise inside Postgres; second-to-finish wins on the
 * password; both responses are valid 201s (research.md Decision 7).
 *
 * Postgres mechanic note: `ALTER ROLE` is a UTILITY statement and does NOT
 * accept bind parameters for its password value. We therefore wrap it in a
 * DO block that uses `format(%I, %L)` to handle identifier + literal
 * quoting server-side — matches upstream's approach byte-for-byte.
 */
import type { FastifyBaseLogger } from 'fastify';

import { generateCliPassword } from './cli-login-role-password.js';
import { withPerInstancePg } from './per-instance-pg.js';

/** TTL applied to every rotated password. Matches upstream `role.sql` (5 min). */
export const TTL_SECONDS = 300;

/** Read-write role: granted `IN ROLE postgres` so the CLI's auto-`SET SESSION ROLE postgres` succeeds. */
export const CLI_LOGIN_ROLE_RW = 'cli_login_postgres';
export const CLI_LOGIN_TARGET_RW = 'postgres';

/** Read-only role: granted `IN ROLE supabase_read_only_user` (`pg_read_all_data` + BYPASSRLS via the supabase/postgres init scripts). */
export const CLI_LOGIN_ROLE_RO = 'cli_login_supabase_read_only_user';
export const CLI_LOGIN_TARGET_RO = 'supabase_read_only_user';

/** Tuple of (login role, target role to inherit) per scope. */
function rolesForScope(readOnly: boolean): {
  role: typeof CLI_LOGIN_ROLE_RW | typeof CLI_LOGIN_ROLE_RO;
  target: typeof CLI_LOGIN_TARGET_RW | typeof CLI_LOGIN_TARGET_RO;
} {
  if (readOnly) return { role: CLI_LOGIN_ROLE_RO, target: CLI_LOGIN_TARGET_RO };
  return { role: CLI_LOGIN_ROLE_RW, target: CLI_LOGIN_TARGET_RW };
}

export interface RotateOpts {
  readOnly: boolean;
  patId: string;
  requesterIp: string;
  logger: FastifyBaseLogger;
}

export interface RotateResult {
  role: string;
  password: string;
  ttlSeconds: number;
}

/**
 * Provision (or re-use) and password-rotate the appropriate CLI login role.
 *
 * Returns the role + brand-new password the caller can hand to a CLI client.
 * Emits a structured `cli_login_role_rotated` audit event on success.
 *
 * May throw any of:
 *   - `InstanceNotFoundError` — caller-controlled error from per-instance-pg.ts;
 *     route layer maps to 404.
 *   - `InstanceNotRunningError` — project exists but PG is not running
 *     (provisioning/paused/restoring). Route layer maps to 409.
 *   - `PerInstancePgConnectError` — network/SCRAM problem reaching the
 *     per-project PG. Route layer maps to 502.
 *   - Other PG errors propagate as-is and are treated as 500.
 */
export async function rotateCliLoginRole(
  ref: string,
  opts: RotateOpts,
): Promise<RotateResult> {
  const { readOnly, patId, requesterIp, logger } = opts;
  const { role, target } = rolesForScope(readOnly);
  const password = generateCliPassword();
  const scope = readOnly ? 'read_only' : 'read_write';
  const lockKey = `${ref}:${readOnly ? 'ro' : 'rw'}`;

  // Compute VALID UNTIL client-side. The api container and the per-project
  // PG run on the same VM, so clock skew is bounded (NTP); any difference
  // is dwarfed by the 5-minute window. Server-side `now()+interval` would
  // also work but requires a DO/format() wrapper around an otherwise simple
  // utility statement, and DO bodies don't accept bind parameters which
  // collides with how we want to inline the random password.
  const validUntil = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

  await withPerInstancePg(ref, async (client) => {
    await client.query('BEGIN');
    try {
      // Decision 7: serialise concurrent calls per (project, scope) so two
      // racing rotations don't surface as a transient existence/validity gap.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

      // 1) Idempotent CREATE-IF-NOT-EXISTS. `CREATE ROLE` is a utility
      //    statement (no IF NOT EXISTS clause, doesn't accept bind
      //    parameters for identifiers), so we do an explicit pre-check
      //    inside the same transaction.
      const existsRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
        [role],
      );
      if (!existsRes.rows[0]?.exists) {
        // Identifiers can't be bind parameters — use escapeIdentifier.
        await client.query(
          `CREATE ROLE ${client.escapeIdentifier(role)} NOINHERIT LOGIN NOREPLICATION IN ROLE ${client.escapeIdentifier(target)}`,
        );
      }

      // 2) Rotate password + refresh VALID UNTIL. `ALTER ROLE` is also a
      //    utility statement, so role + password + VALID UNTIL are inlined
      //    via escapeIdentifier / escapeLiteral.
      await client.query(
        `ALTER ROLE ${client.escapeIdentifier(role)} WITH PASSWORD ${client.escapeLiteral(password)} VALID UNTIL ${client.escapeLiteral(validUntil)}`,
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });

  logger.info(
    {
      event: 'cli_login_role_rotated',
      pat_id: patId,
      project_ref: ref,
      scope,
      requester_ip: requesterIp,
      role,
    },
    'cli login role rotated',
  );

  return { role, password, ttlSeconds: TTL_SECONDS };
}

export interface InvalidateOpts {
  patId: string;
  requesterIp: string;
  logger: FastifyBaseLogger;
}

/**
 * Invalidate any active passwords on both CLI roles by ALTERing their
 * `VALID UNTIL` to 1970-01-01. Already-authenticated connections continue
 * to function until they close naturally; new SCRAM exchanges are refused.
 * Idempotent: if either role doesn't exist, that branch is skipped.
 *
 * Note: DOES NOT consume the rate-limit bucket. The bucket gates the
 * create endpoint only; spec FR-002 treats DELETE as a lockdown lever that
 * an operator must always be able to wield.
 */
export async function invalidateCliLoginRoles(
  ref: string,
  opts: InvalidateOpts,
): Promise<void> {
  const { patId, requesterIp, logger } = opts;

  await withPerInstancePg(ref, async (client) => {
    // Same constraint as rotate: utility statements + no DO trickery. Two
    // discrete round-trips, each guarded by an existence check.
    for (const r of [CLI_LOGIN_ROLE_RW, CLI_LOGIN_ROLE_RO] as const) {
      const existsRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
        [r],
      );
      if (existsRes.rows[0]?.exists) {
        await client.query(
          `ALTER ROLE ${client.escapeIdentifier(r)} VALID UNTIL ${client.escapeLiteral('1970-01-01')}`,
        );
      }
    }
  });

  logger.info(
    {
      event: 'cli_login_role_invalidated',
      pat_id: patId,
      project_ref: ref,
      requester_ip: requesterIp,
    },
    'cli login roles invalidated',
  );
}

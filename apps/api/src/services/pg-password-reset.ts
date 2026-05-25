/**
 * Reset per-instance Postgres password — feature 008 US3 recovery (FR-016).
 *
 * Decrypts the stored postgresPassword from encrypted_secrets, then runs
 *   ALTER USER postgres WITH PASSWORD '<pwd>';
 *   ALTER USER supabase_admin WITH PASSWORD '<pwd>';
 * inside a single transaction against the per-instance db container via
 * docker exec + psql.
 *
 * Uses 127.0.0.1 trust auth (supabase template's pg_hba allows this for
 * connections originating inside the container). Authenticates as
 * `supabase_admin` because both target roles are privileged and only a
 * superuser can ALTER them (per research.md Decision 6 + ASYO fix experience).
 *
 * Password is passed via psql -c (no shell env exposure). PG-quoted via
 * '' → '''' escape rule.
 */
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import type { InstanceSecrets } from './instance-secrets.js';

const DOCKER_SOCK = '/var/run/docker.sock';

export class InstanceNotFoundForResetError extends Error {
  code = 'instance_not_found' as const;
}
export class InstanceNotResettableError extends Error {
  code = 'project_not_running' as const;
  constructor(public readonly status: string) {
    super(`Project status '${status}' — cannot reset password (must be running or failed)`);
  }
}
export class PerInstanceDbUnreachableError extends Error {
  code = 'per_instance_db_unreachable' as const;
  constructor(message: string) {
    super(message);
  }
}

/** Statuses where the reset endpoint is safe to invoke. */
const RESETTABLE_STATUSES = new Set(['running', 'failed', 'stopped']);

export async function resetPgPasswordForInstance(ref: string): Promise<void> {
  const [inst] = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      status: schema.supabaseInstances.status,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) throw new InstanceNotFoundForResetError(`instance ${ref} not found`);
  if (!RESETTABLE_STATUSES.has(inst.status)) {
    throw new InstanceNotResettableError(inst.status);
  }

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;
  const sql = buildResetSql(secrets.postgresPassword);
  const containerName = `selfbase-${ref}-db-1`;
  await dockerExecPsql(containerName, sql);
}

/**
 * Build the ALTER USER statements as a single PG transaction. Exported for
 * unit-testing the password escape (PG '' → '''').
 */
export function buildResetSql(password: string): string {
  const escaped = password.replace(/'/g, "''");
  return `BEGIN; ALTER USER postgres WITH PASSWORD '${escaped}'; ALTER USER supabase_admin WITH PASSWORD '${escaped}'; COMMIT;`;
}

/**
 * Run a psql command inside the named container via Docker's exec API.
 * Uses the unix socket (mounted into the api container as /var/run/docker.sock).
 * The SQL is passed via psql's -c flag, so it never appears as a shell arg
 * (avoiding any shell-quoting concerns).
 */
async function dockerExecPsql(container: string, sql: string): Promise<void> {
  const execId = await dockerCreateExec(container, [
    'psql',
    '-h',
    '127.0.0.1',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
  const result = await dockerStartExec(execId);
  // Inspect the exec to get the exit code.
  const inspectExit = await dockerInspectExec(execId);
  if (inspectExit !== 0) {
    throw new PerInstanceDbUnreachableError(
      `docker exec psql in ${container} exited ${inspectExit}: ${result.slice(0, 400)}`,
    );
  }
}

function dockerCreateExec(container: string, cmd: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: cmd,
    });
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        method: 'POST',
        path: `/containers/${container}/exec`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 201) {
            reject(
              new PerInstanceDbUnreachableError(`docker exec create ${res.statusCode}: ${buf}`),
            );
            return;
          }
          try {
            const parsed = JSON.parse(buf) as { Id?: string };
            if (!parsed.Id) {
              reject(new PerInstanceDbUnreachableError('docker exec create: missing Id'));
              return;
            }
            resolve(parsed.Id);
          } catch (err) {
            reject(
              new PerInstanceDbUnreachableError(
                `docker exec create parse: ${(err as Error).message}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', (err) => reject(new PerInstanceDbUnreachableError(err.message)));
    req.write(body);
    req.end();
  });
}

function dockerStartExec(execId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ Detach: false, Tty: false });
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        method: 'POST',
        path: `/exec/${execId}/start`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c.toString()));
        res.on('end', () => resolve(buf));
      },
    );
    req.on('error', (err) => reject(new PerInstanceDbUnreachableError(err.message)));
    req.write(body);
    req.end();
  });
}

function dockerInspectExec(execId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCK, method: 'GET', path: `/exec/${execId}/json` },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(buf) as { ExitCode?: number };
            resolve(parsed.ExitCode ?? -1);
          } catch (err) {
            reject(
              new PerInstanceDbUnreachableError(
                `docker exec inspect parse: ${(err as Error).message}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', (err) => reject(new PerInstanceDbUnreachableError(err.message)));
    req.end();
  });
}

/**
 * Re-key a project's JWT signing identity (feature 123 / SEC-037).
 *
 * Projects provisioned before feature 123 all share ONE HS256 secret, so any
 * one of their service_role keys is valid on every other one's data plane.
 * This script gives an existing project its own secret and re-issues its
 * anon / service_role keys bound to its ref.
 *
 * DESTRUCTIVE TO CLIENTS: the project's current anon and service_role keys
 * stop working the moment its containers come back. Anything holding them —
 * apps, CI, edge functions, SDK clients — must be handed the new keys. There is
 * no dual-accept window: HS256 verification takes one key.
 *
 * Convergent, not merely idempotent. A project whose keys are already ref-bound
 * is NOT skipped — the script re-applies the .env, the GUC, and the container
 * recreation from the secrets already in the control-plane DB. That makes a run
 * interrupted halfway (env written, containers not yet recreated) safe to
 * simply re-run. `--force` additionally mints a brand-new secret.
 *
 * Invocation (from the VM, inside the api container — it holds the master key,
 * the instances mount, and the docker socket). The api image ships source and
 * runs under tsx; `dist/` covers src/ only, so there is no compiled .js here:
 *   docker exec -w /app/apps/api supastack-api-1 \
 *     pnpm exec tsx scripts/rekey-instance-jwt.ts --all --dry-run
 *   docker exec -w /app/apps/api supastack-api-1 \
 *     pnpm exec tsx scripts/rekey-instance-jwt.ts --all --yes
 * Or one project:
 *   … pnpm exec tsx scripts/rekey-instance-jwt.ts <ref> --yes
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { decryptJson, encryptJson, loadMasterKey, signSupabaseJwt } from '@supastack/crypto';
import { makeDb, db, schema } from '@supastack/db';
import { composeExec, composePs, composeUpService } from '@supastack/docker-control';
import { eq, not, inArray } from 'drizzle-orm';
import {
  applyInstanceJwtToEnv,
  JWT_BEARING_SERVICES,
  refClaimOf,
} from '../src/services/instance-jwt-env.js';
import type { InstanceSecrets } from '../src/services/instance-secrets.js';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';
const API_KEY_EXPIRY_SEC = 5 * 365 * 24 * 60 * 60; // 5 years — matches provisioning

interface JwtTriple {
  jwtSecret: string;
  anonKey: string;
  serviceRoleKey: string;
}

function mintTriple(ref: string): JwtTriple {
  const jwtSecret = randomBytes(32).toString('hex');
  return {
    jwtSecret,
    anonKey: signSupabaseJwt(jwtSecret, { role: 'anon', ref, expSec: API_KEY_EXPIRY_SEC }),
    serviceRoleKey: signSupabaseJwt(jwtSecret, {
      role: 'service_role',
      ref,
      expSec: API_KEY_EXPIRY_SEC,
    }),
  };
}

/**
 * `ALTER DATABASE … SET` only takes effect for sessions opened after it runs,
 * which is exactly what we want: the services that read the GUC are recreated
 * immediately afterwards. Mirrors volumes/db/jwt.sql, which runs at initdb and
 * therefore cannot help an already-provisioned project.
 */
async function setJwtGuc(
  ctx: { projectName: string; dir: string },
  jwtSecret: string,
): Promise<void> {
  // ALTER DATABASE takes no bind parameters, so the value is inlined. It is 64
  // hex chars from randomBytes — no quoting hazard — but escape it anyway so
  // this stays safe if the secret's shape ever changes.
  const sql = `ALTER DATABASE postgres SET "app.settings.jwt_secret" TO ${literal(jwtSecret)};`;
  // As `supabase_admin`, not `postgres`. In the Supabase image `postgres` is a
  // privileged-but-not-superuser role, and ALTER DATABASE SET on a reserved
  // `app.settings.*` parameter needs superuser — it fails with "permission
  // denied to set parameter". volumes/db/jwt.sql gets away with `postgres`
  // only because docker-entrypoint-initdb.d runs before the role is demoted.
  const res = await composeExec(ctx, 'db', [
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-c',
    sql,
  ]);
  if (res.exitCode !== 0) throw new Error(`GUC update failed: ${res.stderr.trim()}`);
}

/** Postgres single-quoted literal. */
function literal(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

async function rekeyOne(ref: string, opts: { force: boolean; dryRun: boolean }): Promise<void> {
  const masterKey = loadMasterKey();
  const [inst] = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) throw new Error(`${ref}: no such instance`);

  const existing = decryptJson(inst.encryptedSecrets, masterKey) as InstanceSecrets;
  const alreadyBound = refClaimOf(existing.anonKey) === ref;

  let triple: JwtTriple;
  if (alreadyBound && !opts.force) {
    // Converge: re-apply what the DB already says rather than minting again, so
    // a re-run after a partial failure does not invalidate the keys twice.
    console.warn(`${ref}: already ref-bound — converging (.env, GUC, containers) without minting`);
    triple = {
      jwtSecret: existing.jwtSecret,
      anonKey: existing.anonKey,
      serviceRoleKey: existing.serviceRoleKey,
    };
  } else {
    triple = mintTriple(ref);
  }

  const dir = path.join(INSTANCES_DIR, ref);
  const ctx = { projectName: `supastack-${ref}`, dir };
  const envPath = path.join(dir, '.env');
  const envBefore = await fs.readFile(envPath, 'utf8');
  const envAfter = applyInstanceJwtToEnv(envBefore, triple);

  const present = (await composePs(ctx)).map((c) => c.service);
  const toRecreate = JWT_BEARING_SERVICES.filter((s) => present.includes(s));

  if (opts.dryRun) {
    console.warn(
      `${ref}: DRY RUN — would ${alreadyBound && !opts.force ? 'converge' : 'MINT A NEW SECRET'}, ` +
        `rewrite .env (${envBefore === envAfter ? 'no change' : 'changed'}), set the GUC, ` +
        `and recreate: ${toRecreate.join(', ')}`,
    );
    return;
  }

  // 1. Back up, then write the .env. Do this before the DB update so a crash
  //    leaves a recoverable copy of the previous keys on disk.
  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  await fs.writeFile(`${envPath}.bak-rekey-${stamp}`, envBefore, 'utf8');
  await fs.writeFile(envPath, envAfter, 'utf8');

  // 2. Control-plane DB is the source of truth every API read goes through
  //    (including the temp-key mint), so it must match the .env.
  await db()
    .update(schema.supabaseInstances)
    .set({ encryptedSecrets: encryptJson({ ...existing, ...triple }, masterKey) })
    .where(eq(schema.supabaseInstances.ref, ref));

  // 3. Re-issue the GUC for SQL that reads current_setting('app.settings.jwt_secret').
  await setJwtGuc(ctx, triple.jwtSecret);

  // 4. Recreate (not restart) so each container re-reads the .env. A plain
  //    `docker restart` keeps the old environment and silently leaves the
  //    previous secret in place.
  const failed: string[] = [];
  for (const svc of toRecreate) {
    try {
      await composeUpService(ctx, svc);
    } catch (err) {
      failed.push(svc);
      console.error(`${ref}: recreate ${svc} failed:`, err);
    }
  }
  if (failed.length) {
    throw new Error(`${ref}: ${failed.join(', ')} still hold the OLD key — re-run this script`);
  }

  console.warn(`${ref}: re-keyed. recreated ${toRecreate.join(', ')}`);
  console.warn(`${ref}: new anon key: ${triple.anonKey}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');
  const all = argv.includes('--all');
  const refs = argv.filter((a) => !a.startsWith('--'));

  if (!dryRun && !argv.includes('--yes')) {
    throw new Error(
      'refusing to run without --yes: this invalidates the current anon and ' +
        'service_role keys of every project it touches. Try --dry-run first.',
    );
  }
  if (!all && refs.length === 0) throw new Error('pass one or more refs, or --all');

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL required');
  makeDb(dbUrl);

  const targets = all
    ? (
        await db()
          .select({ ref: schema.supabaseInstances.ref })
          .from(schema.supabaseInstances)
          .where(not(inArray(schema.supabaseInstances.status, ['deleting'])))
      ).map((r) => r.ref)
    : refs;

  console.warn(`rekey: ${targets.length} project(s)${dryRun ? ' (dry run)' : ''}`);
  let ok = 0;
  const failures: string[] = [];
  for (const ref of targets) {
    try {
      await rekeyOne(ref, { force, dryRun });
      ok++;
    } catch (err) {
      failures.push(ref);
      console.error(`${ref}: FAILED —`, err instanceof Error ? err.message : err);
    }
  }
  console.warn(
    `rekey: ${ok} ok, ${failures.length} failed${failures.length ? `: ${failures.join(', ')}` : ''}`,
  );
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

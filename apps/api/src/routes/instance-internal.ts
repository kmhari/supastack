/**
 * Internal endpoint to migrate an existing project to use the platform JWT
 * secret. Call once per project after deploying this change.
 *
 * Root cause: per-project services (Kong/storage/auth/rest) validate JWTs
 * against their own random JWT_SECRET. The platform GoTrue signs operator
 * session JWTs with the HKDF-derived platform secret — a different key —
 * so all direct API calls from the IS_PLATFORM Studio fail with
 * "Invalid Compact JWS". Fix: make every project use the platform secret,
 * matching Supabase Cloud's shared-JWT-infrastructure model.
 *
 * Safe to call multiple times (idempotent check on jwtSecret equality).
 */
import {
  decryptJson,
  deriveGotrueJwtSecret,
  encryptJson,
  loadMasterKey,
  signSupabaseJwt,
} from '@supastack/crypto';
import { db, schema } from '@supastack/db';
import { composeUpService } from '@supastack/docker-control';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';
const API_KEY_EXPIRY_SEC = 5 * 365 * 24 * 60 * 60;

export const instanceInternalRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { ref: string }; Querystring: { force?: string } }>(
    '/internal/instances/:ref/adopt-platform-jwt',
    async (req, reply) => {
      const { ref } = req.params;
      const force = req.query.force === '1';

      const [inst] = await db()
        .select()
        .from(schema.supabaseInstances)
        .where(eq(schema.supabaseInstances.ref, ref))
        .limit(1);
      if (!inst) return reply.status(404).send({ error: 'instance not found' });

      const masterKey = loadMasterKey();
      const jwtSecret = deriveGotrueJwtSecret(masterKey);

      const existing = decryptJson<Record<string, string>>(inst.encryptedSecrets, masterKey);
      if (existing.jwtSecret === jwtSecret && !force) {
        return reply.status(200).send({ ok: true, skipped: 'already using platform jwt secret' });
      }

      const anonKey = signSupabaseJwt(jwtSecret, { role: 'anon', expSec: API_KEY_EXPIRY_SEC });
      const serviceRoleKey = signSupabaseJwt(jwtSecret, {
        role: 'service_role',
        expSec: API_KEY_EXPIRY_SEC,
      });

      // 1. Update encryptedSecrets in DB
      await db()
        .update(schema.supabaseInstances)
        .set({
          encryptedSecrets: encryptJson(
            { ...existing, jwtSecret, anonKey, serviceRoleKey },
            masterKey,
          ),
        })
        .where(eq(schema.supabaseInstances.ref, ref));

      // 2. Patch the three JWT-related lines in the per-project .env file.
      //    Kong reads SUPABASE_ANON_KEY=${ANON_KEY} and SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY}
      //    at startup, so updating ANON_KEY and SERVICE_ROLE_KEY is enough.
      const envPath = path.join(INSTANCES_DIR, ref, '.env');
      let envContent = await fs.readFile(envPath, 'utf8');
      envContent = envContent.replace(/^JWT_SECRET=.*/m, `JWT_SECRET=${jwtSecret}`);
      envContent = envContent.replace(/^ANON_KEY=.*/m, `ANON_KEY=${anonKey}`);
      envContent = envContent.replace(/^SERVICE_ROLE_KEY=.*/m, `SERVICE_ROLE_KEY=${serviceRoleKey}`);
      await fs.writeFile(envPath, envContent, 'utf8');

      // 3. Re-create (not just restart) the containers that validate JWTs so
      //    they pick up the new JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY from
      //    the patched .env file.  composeUpService runs
      //    `docker compose up -d --no-deps <service>` which re-reads the .env
      //    and recreates the container; plain `docker restart` keeps the
      //    existing env and would silently leave the old secret in place.
      const ctx = { projectName: `supastack-${ref}`, dir: path.join(INSTANCES_DIR, ref) };
      const services = ['kong', 'storage', 'auth', 'rest'];
      const restartResults: Record<string, string> = {};
      for (const svc of services) {
        try {
          await composeUpService(ctx, svc);
          restartResults[svc] = 'ok';
        } catch (err) {
          app.log.warn({ service: svc, err }, 'composeUpService failed during jwt adoption');
          restartResults[svc] = 'failed';
        }
      }

      app.log.info({ ref, restartResults }, 'platform jwt adoption complete');
      return reply.status(200).send({ ok: true, restartResults });
    },
  );
};

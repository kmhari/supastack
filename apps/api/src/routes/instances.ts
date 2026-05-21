import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { and, desc, eq, inArray, not } from 'drizzle-orm';
import { db, schema, allocatePorts } from '@selfbase/db';
import { generateRef, decryptJson, loadMasterKey, verifyPassword } from '@selfbase/crypto';
import { schemas, errors, canTransition, type InstanceState } from '@selfbase/shared';
import {
  encryptInstanceSecrets,
  generateInstanceSecrets,
  type InstanceSecrets,
} from '../services/instance-secrets.js';

const SUPABASE_VERSION_DEFAULT = process.env.SUPABASE_VERSION ?? '2026.05.01';
const REDIS_URL = process.env.REDIS_URL!;

let _provisionQueue: Queue | null = null;
function provisionQueue(): Queue {
  if (!_provisionQueue) {
    _provisionQueue = new Queue('selfbase.provision', {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return _provisionQueue;
}

let _lifecycleQueue: Queue | null = null;
function lifecycleQueue(): Queue {
  if (!_lifecycleQueue) {
    _lifecycleQueue = new Queue('selfbase.lifecycle', {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return _lifecycleQueue;
}

const PUBLIC_INSTANCE_FIELDS = (apex: string | null) => ({
  ref: schema.supabaseInstances.ref,
  name: schema.supabaseInstances.name,
  status: schema.supabaseInstances.status,
  supabaseVersion: schema.supabaseInstances.supabaseVersion,
  portKong: schema.supabaseInstances.portKong,
  portStudio: schema.supabaseInstances.portStudio,
  backupAutoEnabled: schema.supabaseInstances.backupAutoEnabled,
  backupRetain: schema.supabaseInstances.backupRetain,
  lastBackupAt: schema.supabaseInstances.lastBackupAt,
  provisionError: schema.supabaseInstances.provisionError,
  createdAt: schema.supabaseInstances.createdAt,
  updatedAt: schema.supabaseInstances.updatedAt,
  // `apex` is broadcast into rows so the client can compute URLs without
  // a second round-trip.
  apex:
    apex !== null
      ? eq(schema.supabaseInstances.ref, schema.supabaseInstances.ref)
      : eq(schema.supabaseInstances.ref, schema.supabaseInstances.ref),
});

async function getApex(): Promise<string | null> {
  const rows = await db().select({ apex: schema.org.apexDomain }).from(schema.org).limit(1);
  return rows[0]?.apex ?? null;
}

function instanceUrls(ref: string, apex: string | null) {
  if (!apex) return { kong: null, studio: null };
  return {
    kong: `https://${ref}.${apex}`,
    studio: `https://${ref}.${apex}/studio`,
  };
}

export const instancesRoutes: FastifyPluginAsync = async (app) => {
  // ─── LIST ────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { status?: string } }>('/instances', async (req, reply) => {
    app.authorize(req, 'instance.list');
    const user = app.requireAuth(req);

    const statusFilter = req.query.status;
    const baseQuery = db()
      .select()
      .from(schema.supabaseInstances)
      .orderBy(desc(schema.supabaseInstances.createdAt));

    const rows = statusFilter
      ? await db()
          .select()
          .from(schema.supabaseInstances)
          .where(eq(schema.supabaseInstances.status, statusFilter as InstanceState))
          .orderBy(desc(schema.supabaseInstances.createdAt))
      : await baseQuery;

    const apex = await getApex();
    return reply.send(rows.map((r) => projectRow(r, apex, user.role)));
  });

  // ─── GET one ─────────────────────────────────────────────────────────────
  app.get<{ Params: { ref: string } }>('/instances/:ref', async (req, reply) => {
    app.authorize(req, 'instance.read');
    const user = app.requireAuth(req);
    const row = await fetchInstance(req.params.ref);
    const apex = await getApex();
    return reply.send(projectRow(row, apex, user.role));
  });

  // ─── CREATE ──────────────────────────────────────────────────────────────
  app.post('/instances', async (req, reply) => {
    app.authorize(req, 'instance.create');
    const user = app.requireAuth(req);
    const body = schemas.InstanceCreateRequest.parse(req.body);

    const [orgRow] = await db().select({ id: schema.org.id }).from(schema.org).limit(1);
    if (!orgRow) throw errors.invalidInput('org not initialized — complete /setup first');

    const ref = generateRef();
    const secrets = generateInstanceSecrets({ jwtExpirySec: body.jwtExpirySec });
    const encryptedSecrets = encryptInstanceSecrets(secrets);

    // SMTP password (if provided) encrypted separately so future granular
    // reveal can target only the SMTP field.
    let smtpPassEncrypted: Buffer | null = null;
    if (body.smtp) {
      const { encryptJson } = await import('@selfbase/crypto');
      smtpPassEncrypted = encryptJson({ password: body.smtp.password }, loadMasterKey());
    }

    // Allocate ports + insert in one tx (per port_allocator design).
    await db().transaction(async (tx) => {
      const ports = await allocatePorts(tx as never, ref);
      await tx.insert(schema.supabaseInstances).values({
        ref,
        orgId: orgRow.id,
        name: body.name,
        status: 'provisioning',
        supabaseVersion: body.supabaseVersion ?? SUPABASE_VERSION_DEFAULT,
        encryptedSecrets,
        portKong: ports.kong,
        portStudio: ports.studio,
        portPostgres: ports.postgres,
        portPooler: ports.pooler,
        portAnalytics: ports.analytics,
        createSmtpHost: body.smtp?.host ?? null,
        createSmtpPort: body.smtp?.port ?? null,
        createSmtpUser: body.smtp?.user ?? null,
        createSmtpPassEncrypted: smtpPassEncrypted,
        createEnableSignup: body.enableSignup,
        createJwtExpirySec: body.jwtExpirySec,
        backupAutoEnabled: body.backupAutoEnabled,
        backupRetain: body.backupRetain,
      });
      await tx.insert(schema.auditLog).values({
        actorUserId: user.id,
        action: 'instance.create',
        targetKind: 'instance',
        targetId: ref,
        payload: { name: body.name },
      });
    });

    await provisionQueue().add('provision', { ref }, { removeOnComplete: 100 });

    return reply.status(202).send({ ref, name: body.name, status: 'provisioning' });
  });

  // ─── PATCH (rename / backup config) ──────────────────────────────────────
  app.patch<{ Params: { ref: string } }>('/instances/:ref', async (req, reply) => {
    app.authorize(req, 'instance.update');
    const body = schemas.InstancePatchRequest.parse(req.body);
    const row = await fetchInstance(req.params.ref);
    await db()
      .update(schema.supabaseInstances)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.backupAutoEnabled !== undefined
          ? { backupAutoEnabled: body.backupAutoEnabled }
          : {}),
        ...(body.backupRetain !== undefined ? { backupRetain: body.backupRetain } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.supabaseInstances.ref, row.ref));
    const updated = await fetchInstance(row.ref);
    const apex = await getApex();
    const user = app.requireAuth(req);
    return reply.send(projectRow(updated, apex, user.role));
  });

  // ─── LIFECYCLE (pause / resume / restart / delete) ───────────────────────
  app.post<{ Params: { ref: string } }>('/instances/:ref/pause', async (req, reply) => {
    return enqueueLifecycle(req, reply, app, 'pause', 'paused');
  });
  app.post<{ Params: { ref: string } }>('/instances/:ref/resume', async (req, reply) => {
    return enqueueLifecycle(req, reply, app, 'resume', 'running');
  });
  app.post<{ Params: { ref: string } }>('/instances/:ref/restart', async (req, reply) => {
    return enqueueLifecycle(req, reply, app, 'restart', null);
  });
  app.post<{ Params: { ref: string } }>('/instances/:ref/upgrade', async (req, reply) => {
    app.authorize(req, 'instance.upgrade');
    const user = app.requireAuth(req);
    const body = schemas.InstanceUpgradeRequest.parse(req.body);
    const row = await fetchInstance(req.params.ref);
    // Must be in a stable state to upgrade
    if (!['running', 'paused', 'stopped'].includes(row.status)) {
      throw errors.invalidStateTransition(row.status, 'upgrading');
    }
    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: user.id,
        action: 'instance.upgrade',
        targetKind: 'instance',
        targetId: row.ref,
        payload: {
          from: row.supabaseVersion,
          to: body.supabaseVersion,
          backupFirst: body.backupFirst,
        },
      });
    await lifecycleQueue().add(
      'upgrade',
      { ref: row.ref, supabaseVersion: body.supabaseVersion, backupFirst: body.backupFirst },
      { removeOnComplete: 100 },
    );
    return reply.status(202).send({ ref: row.ref, status: 'upgrading' });
  });
  app.delete<{ Params: { ref: string } }>('/instances/:ref', async (req, reply) => {
    app.authorize(req, 'instance.delete');
    const user = app.requireAuth(req);
    const row = await fetchInstance(req.params.ref);
    if (!canTransition(row.status as InstanceState, 'deleting')) {
      throw errors.invalidStateTransition(row.status, 'deleting');
    }
    await db()
      .update(schema.supabaseInstances)
      .set({ status: 'deleting', updatedAt: new Date() })
      .where(eq(schema.supabaseInstances.ref, row.ref));
    await db().insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'instance.delete',
      targetKind: 'instance',
      targetId: row.ref,
    });
    await lifecycleQueue().add('delete', { ref: row.ref }, { removeOnComplete: 100 });
    return reply.status(202).send({ ref: row.ref, status: 'deleting' });
  });

  // ─── CREDENTIALS REVEAL (re-auth + audit) ────────────────────────────────
  app.post<{ Params: { ref: string } }>(
    '/instances/:ref/credentials/reveal',
    async (req, reply) => {
      app.authorize(req, 'instance.reveal-credentials');
      const user = app.requireAuth(req);
      const body = schemas.CredentialRevealRequest.parse(req.body);

      // Re-authenticate against the user's password.
      const [u] = await db()
        .select({ hash: schema.users.hashedPassword })
        .from(schema.users)
        .where(eq(schema.users.id, user.id))
        .limit(1);
      if (!u || !(await verifyPassword(u.hash, body.password))) {
        throw errors.reauthRequired();
      }

      const row = await fetchInstance(req.params.ref);
      const secrets = decryptJson<InstanceSecrets>(row.encryptedSecrets, loadMasterKey());

      await db().insert(schema.auditLog).values({
        actorUserId: user.id,
        action: 'secret.reveal',
        targetKind: 'instance',
        targetId: row.ref,
      });

      const apex = await getApex();
      const urls = instanceUrls(row.ref, apex);
      return reply.send({
        ref: row.ref,
        anonKey: secrets.anonKey,
        serviceRoleKey: secrets.serviceRoleKey,
        jwtSecret: secrets.jwtSecret,
        postgresPassword: secrets.postgresPassword,
        dashboardPassword: secrets.dashboardPassword,
        connectionStrings: {
          rest: `${urls.kong}/rest/v1/`,
          auth: `${urls.kong}/auth/v1/`,
          storage: `${urls.kong}/storage/v1/`,
          // Direct DB is private in v1 — host-local only.
          directDb: `postgres://postgres:${secrets.postgresPassword}@127.0.0.1:${row.portPostgres}/postgres`,
        },
      });
    },
  );
};

// ─── helpers ────────────────────────────────────────────────────────────────

async function fetchInstance(ref: string): Promise<typeof schema.supabaseInstances.$inferSelect> {
  const [row] = await db()
    .select()
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!row) throw errors.notFound(`instance ${ref} not found`);
  return row;
}

function projectRow(
  row: typeof schema.supabaseInstances.$inferSelect,
  apex: string | null,
  role: 'admin' | 'member',
) {
  const base = {
    ref: row.ref,
    name: row.name,
    status: row.status,
    supabaseVersion: row.supabaseVersion,
    backupAutoEnabled: row.backupAutoEnabled,
    backupRetain: row.backupRetain,
    lastBackupAt: row.lastBackupAt,
    provisionError: row.provisionError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    urls: instanceUrls(row.ref, apex),
  };
  if (role === 'admin') {
    return {
      ...base,
      ports: {
        kong: row.portKong,
        studio: row.portStudio,
        postgres: row.portPostgres,
        pooler: row.portPooler,
        analytics: row.portAnalytics,
      },
    };
  }
  // Members get a narrower view (no port_postgres etc).
  return {
    ...base,
    ports: { kong: row.portKong, studio: row.portStudio },
  };
}

async function enqueueLifecycle(
  req: FastifyRequest<{ Params: { ref: string } }>,
  reply: FastifyReply,
  app: FastifyInstance,
  action: 'pause' | 'resume' | 'restart',
  targetStatus: 'paused' | 'running' | null,
) {
  const actionMap = {
    pause: 'instance.pause',
    resume: 'instance.resume',
    restart: 'instance.restart',
  } as const;
  app.authorize(req, actionMap[action]);
  const user = app.requireAuth(req);
  const row = await fetchInstance(req.params.ref);
  if (targetStatus && !canTransition(row.status as InstanceState, targetStatus)) {
    throw errors.invalidStateTransition(row.status, targetStatus);
  }
  await db().insert(schema.auditLog).values({
    actorUserId: user.id,
    action: actionMap[action],
    targetKind: 'instance',
    targetId: row.ref,
  });
  await lifecycleQueue().add(action, { ref: row.ref }, { removeOnComplete: 100 });
  return reply.status(202).send({ ref: row.ref, status: row.status });
}

// silence unused-import warnings for fields not used by every code path
void PUBLIC_INSTANCE_FIELDS;
void and;
void inArray;
void not;

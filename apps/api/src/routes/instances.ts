import { decryptJson, generateRef, loadMasterKey } from '@supastack/crypto';
import { allocatePorts, assignPortsToInstance, db, schema } from '@supastack/db';
import { composePs } from '@supastack/docker-control';
import { canTransition, errors, schemas, type InstanceState } from '@supastack/shared';
import { Queue } from 'bullmq';
import { and, desc, eq, inArray, not } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import path from 'node:path';
import { probeHttpsCert } from '../services/cert-probe.js';
import {
  encryptInstanceSecrets,
  generateInstanceSecrets,
  type InstanceSecrets,
} from '../services/instance-secrets.js';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';

const SUPABASE_VERSION_DEFAULT = process.env.SUPABASE_VERSION ?? '2026.05.01';
const REDIS_URL = process.env.REDIS_URL!;

let _provisionQueue: Queue | null = null;
function provisionQueue(): Queue {
  if (!_provisionQueue) {
    _provisionQueue = new Queue('supastack.provision', {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return _provisionQueue;
}

let _lifecycleQueue: Queue | null = null;
function lifecycleQueue(): Queue {
  if (!_lifecycleQueue) {
    _lifecycleQueue = new Queue('supastack.lifecycle', {
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
    // Studio lives on its own subdomain — the data-plane subdomain above is
    // reserved for SDK + CLI traffic (Kong's `dashboard` catch-all has been
    // removed from kong.yml).
    studio: `https://studio-${ref}.${apex}`,
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
    const projected = projectRow(row, apex, user.role);
    // Probe the per-instance HTTPS endpoint so the UI can hide the
    // public URL/Studio link until Let's Encrypt has issued a real
    // cert. Cheap: handshake against caddy:443 inside the docker
    // network. Only meaningful when the instance is running AND apex
    // is configured.
    const cert =
      apex && row.status === 'running' ? await probeHttpsCert(`${row.ref}.${apex}`) : null;
    return reply.send({ ...projected, cert });
  });

  // ─── CREATE ──────────────────────────────────────────────────────────────
  app.post('/instances', async (req, reply) => {
    app.authorize(req, 'instance.create');
    const user = app.requireAuth(req);
    const body = schemas.InstanceCreateRequest.parse(req.body);

    const [orgRow] = await db().select({ id: schema.org.id }).from(schema.org).limit(1);
    if (!orgRow) throw errors.invalidInput('org not initialized — complete /setup first');

    const ref = generateRef();
    const secrets = generateInstanceSecrets({
      jwtExpirySec: body.jwtExpirySec,
      postgresPasswordOverride: body.dbPassword,
    });
    const encryptedSecrets = encryptInstanceSecrets(secrets);

    // SMTP password (if provided) encrypted separately so future granular
    // reveal can target only the SMTP field.
    let smtpPassEncrypted: Buffer | null = null;
    if (body.smtp) {
      const { encryptJson } = await import('@supastack/crypto');
      smtpPassEncrypted = encryptJson({ password: body.smtp.password }, loadMasterKey());
    }

    // Allocate ports + insert in one tx. FK ordering: port_allocations.instance_ref
    // references supabase_instances.ref, so allocate ports with NULL instance_ref
    // first, then insert the instance row, then backfill instance_ref on the
    // port allocations — all within a single transaction so a rollback cleans
    // both up.
    await db().transaction(async (tx) => {
      const ports = await allocatePorts(tx as never, null);
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
        portDbDirect: ports.dbDirect,
        createSmtpHost: body.smtp?.host ?? null,
        createSmtpPort: body.smtp?.port ?? null,
        createSmtpUser: body.smtp?.user ?? null,
        createSmtpPassEncrypted: smtpPassEncrypted,
        createEnableSignup: body.enableSignup,
        createJwtExpirySec: body.jwtExpirySec,
        backupAutoEnabled: body.backupAutoEnabled,
        backupRetain: body.backupRetain,
      });
      // Backfill the FK now that the supabase_instances row exists.
      await assignPortsToInstance(tx as never, ref, ports);
      await tx.insert(schema.auditLog).values({
        actorUserId: user.id,
        action: 'instance.create',
        targetKind: 'instance',
        targetId: ref,
        payload: { name: body.name },
      });
    });

    // CI e2e mode: the worker isn't running, so the provision job would
    // sit unprocessed and projects would stay `provisioning` forever (which
    // makes every project-shell page render an empty/error state and fails
    // every browser-test assertion against a project ref). Flip status to
    // `running` synchronously and skip the queue.
    if (process.env.SUPASTACK_TEST_FAKE_DOCKER === '1') {
      await db()
        .update(schema.supabaseInstances)
        .set({ status: 'running' })
        .where(eq(schema.supabaseInstances.ref, ref));
      return reply.status(202).send({ ref, name: body.name, status: 'running' });
    }

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
  app.post<{ Params: { ref: string } }>('/instances/:ref/restart-db', async (req, reply) => {
    return enqueueLifecycle(req, reply, app, 'restart-db', null);
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
  app.get<{ Params: { ref: string } }>('/instances/:ref/health', async (req, reply) => {
    app.requireAuth(req);
    const row = await fetchInstance(req.params.ref);
    let containers: Awaited<ReturnType<typeof composePs>> = [];
    try {
      containers = await composePs({
        projectName: `supastack-${row.ref}`,
        dir: path.join(INSTANCES_DIR, row.ref),
      });
    } catch {
      // Stack not yet up (provision in-flight) or socket unreachable — return
      // an empty list rather than 500ing the UI poll.
    }
    const summary = containers.reduce(
      (a, c) => {
        if (c.health === 'healthy') a.healthy += 1;
        else if (c.health === 'unhealthy') a.unhealthy += 1;
        else if (c.health === 'starting') a.starting += 1;
        else a.none += 1;
        if (c.state === 'running') a.running += 1;
        return a;
      },
      { healthy: 0, unhealthy: 0, starting: 0, none: 0, running: 0, total: containers.length },
    );
    return reply.send({
      ref: row.ref,
      status: row.status,
      containers,
      summary,
      generatedAt: new Date().toISOString(),
    });
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

  // ─── CREDENTIALS REVEAL (audit) ──────────────────────────────────────────
  app.post<{ Params: { ref: string } }>(
    '/instances/:ref/credentials/reveal',
    async (req, reply) => {
      app.authorize(req, 'instance.reveal-credentials');
      const user = app.requireAuth(req);

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
  action: 'pause' | 'resume' | 'restart' | 'restart-db',
  targetStatus: 'paused' | 'running' | null,
) {
  const actionMap = {
    pause: 'instance.pause',
    resume: 'instance.resume',
    restart: 'instance.restart',
    'restart-db': 'instance.restart',
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

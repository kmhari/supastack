import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// GET /platform/projects/:ref/settings — Studio's project API/connection page.
// Wire-compatible with Cloud: jwt_secret + service_api_keys (anon + service_role)
// + db connection details. Org-membership scoped via the join (non-member → 404).

vi.mock('drizzle-orm', () => ({ and: () => ({}), desc: () => ({}), eq: () => ({}), isNull: () => ({}), sql: () => ({}) }));

let instRows: unknown[] = [];
let secretsObj: Record<string, unknown> = {};

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => instRows }),
        }),
      }),
    }),
  }),
  schema: { supabaseInstances: {}, organizationMembers: {} },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => secretsObj,
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', () => {
    if (!authed) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    return { id: 'u1', email: 'op@x.dev', role: 'developer' as const };
  });
  app.decorate('authorizeOrg', async () => 'developer' as const);
  await app.register(platformMiscRoutes);
  return app;
}

const REF = 'tbnqljlgozpxzhkjxats';

describe('GET /platform/projects/:ref/settings', () => {
  beforeEach(() => {
    instRows = [];
    secretsObj = {};
    process.env.SUPASTACK_APEX = 'supaviser.dev';
  });

  it('happy: member + running project → 200 with jwt_secret, anon + service_role keys, db host', async () => {
    instRows = [
      {
        ref: REF,
        name: 'huntvox',
        status: 'running',
        encryptedSecrets: Buffer.from('cipher'),
        insertedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    secretsObj = { jwtSecret: 'JWTSECRET', anonKey: 'ANONKEY', serviceRoleKey: 'SERVICEKEY' };
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/settings` });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.ref).toBe(REF);
    expect(b.name).toBe('huntvox');
    expect(b.status).toBe('ACTIVE_HEALTHY');
    expect(b.inserted_at).toBe('2026-01-01T00:00:00.000Z');
    // DB connection block
    expect(b.db_host).toBe(`db.${REF}.supaviser.dev`);
    expect(b.db_port).toBe(5432);
    expect(b.db_user).toBe('postgres');
    expect(b.db_name).toBe('postgres');
    expect(b.cloud_provider).toBe('SUPASTACK');
    expect(b.ssl_enforced).toBe(false);
    // app_config endpoints
    expect(b.app_config.endpoint).toBe(`${REF}.supaviser.dev`);
    expect(b.app_config.storage_endpoint).toBe(`${REF}.supaviser.dev`);
    expect(b.app_config.db_schema).toBe('public');
    // secrets
    expect(b.jwt_secret).toBe('JWTSECRET');
    expect(b.service_api_keys).toHaveLength(2);
    expect(b.service_api_keys[0]).toMatchObject({ api_key: 'ANONKEY', name: 'anon key', tags: 'anon' });
    expect(b.service_api_keys[1]).toMatchObject({ api_key: 'SERVICEKEY', name: 'service_role key', tags: 'service_role' });
    await app.close();
  });

  it('happy: a non-running status is upper-cased (paused → PAUSED)', async () => {
    instRows = [{ ref: REF, name: 'p', status: 'paused', encryptedSecrets: Buffer.from('x'), insertedAt: new Date() }];
    secretsObj = { jwtSecret: 'j', anonKey: 'a', serviceRoleKey: 's' };
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/settings` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PAUSED');
    await app.close();
  });

  it('happy: no apex configured → falls back to localhost host (no crash)', async () => {
    process.env.SUPASTACK_APEX = '';
    instRows = [{ ref: REF, name: 'p', status: 'running', encryptedSecrets: Buffer.from('x'), insertedAt: new Date() }];
    secretsObj = { jwtSecret: 'j', anonKey: 'a', serviceRoleKey: 's' };
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/settings` });
    const b = res.json();
    expect(b.db_host).toBe('localhost');
    expect(b.app_config.endpoint).toBe('localhost');
    await app.close();
  });

  it('edge: missing/empty encrypted secrets → jwt_secret + keys are empty strings, not undefined', async () => {
    instRows = [{ ref: REF, name: 'p', status: 'running', encryptedSecrets: null, insertedAt: new Date() }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/settings` });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.jwt_secret).toBe('');
    expect(b.service_api_keys[0].api_key).toBe('');
    expect(b.service_api_keys[1].api_key).toBe('');
    await app.close();
  });

  it('sad: project not found / caller not a member of its org → 404', async () => {
    instRows = []; // the membership join yields no row
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/settings` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('sad: unauthenticated → 401 (requireAuth throws before any db read)', async () => {
    instRows = [{ ref: REF, name: 'p', status: 'running', encryptedSecrets: Buffer.from('x'), insertedAt: new Date() }];
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/settings` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

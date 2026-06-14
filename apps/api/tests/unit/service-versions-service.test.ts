/**
 * Real per-project service versions (GET /platform/projects/:ref/service-versions
 * + GET /v1/projects/:ref/services).
 *
 * Writes a fake per-instance compose into a temp INSTANCES_DIR and asserts the
 * tags are parsed from it (happy), falls back to FALLBACK_TAGS when the compose
 * is absent (failure), and that FALLBACK_TAGS never drifts from the template.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// INSTANCES_DIR is captured at module load → set it before importing the service.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supastack-svcver-'));
process.env.INSTANCES_DIR = tmpRoot;

// instance row for getProjectServices' status lookup.
let instanceRow: { status: string } | undefined;
vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (instanceRow ? [instanceRow] : []) }),
      }),
    }),
  }),
  schema: { supabaseInstances: { status: 'status', ref: 'ref' } },
}));

const { readImageTags, getServiceVersions, getProjectServices, FALLBACK_TAGS, SERVICE_IMAGE_REPO } =
  await import('../../src/services/service-versions-service.js');

const COMPOSE = `services:
  db:
    image: supabase/postgres:15.8.1.085
  auth:
    image: supabase/gotrue:v2.186.0
  rest:
    image: postgrest/postgrest:v14.8
  realtime:
    image: supabase/realtime:v2.76.5
  storage:
    image: supabase/storage-api:v1.60.10
  functions:
    image: supabase/edge-runtime:v1.74.0
`;

const REF = 'projref0000000000001';
function writeCompose(ref: string, body: string) {
  const dir = path.join(tmpRoot, ref);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), body);
}

beforeAll(() => writeCompose(REF, COMPOSE));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
beforeEach(() => {
  instanceRow = { status: 'running' };
});

describe('service versions — happy path (real tags from compose)', () => {
  it('parses image tags from the project compose', async () => {
    const tags = await readImageTags(REF);
    expect(tags.db).toBe('15.8.1.085');
    expect(tags.auth).toBe('v2.186.0');
    expect(tags.rest).toBe('v14.8');
    expect(tags.storage).toBe('v1.60.10');
  });

  it('getServiceVersions returns the upstream ServiceVersions shape', async () => {
    const v = await getServiceVersions(REF);
    expect(v).toEqual({
      'supabase-postgres': '15.8.1.085',
      gotrue: 'v2.186.0',
      postgrest: 'v14.8',
    });
  });

  it('getProjectServices returns real `<repo>:<tag>` versions + running status', async () => {
    const { services, notFound } = await getProjectServices(REF);
    expect(notFound).toBeUndefined();
    const db = services.find((s) => s.name === 'db')!;
    expect(db.version).toBe('supabase/postgres:15.8.1.085');
    expect(db.status).toBe('ACTIVE_HEALTHY');
    // storage tag is the real one, not the old stale v1.48.26 stub value
    expect(services.find((s) => s.name === 'storage')!.version).toBe(
      'supabase/storage-api:v1.60.10',
    );
  });
});

describe('service versions — failure / edge paths', () => {
  it('falls back to FALLBACK_TAGS when the compose file is missing', async () => {
    const tags = await readImageTags('does-not-exist-ref');
    expect(tags).toEqual(FALLBACK_TAGS);
  });

  it('per-service fallback when a single image line is absent', async () => {
    const ref = 'partialref000000001';
    writeCompose(ref, 'services:\n  db:\n    image: supabase/postgres:99.9.9\n');
    const tags = await readImageTags(ref);
    expect(tags.db).toBe('99.9.9'); // parsed
    expect(tags.auth).toBe(FALLBACK_TAGS.auth); // missing line → fallback
  });

  it('getProjectServices → notFound for an unknown ref', async () => {
    instanceRow = undefined;
    const res = await getProjectServices('nope');
    expect(res.notFound).toBe(true);
    expect(res.services).toEqual([]);
  });

  it('status reflects a non-running instance (COMING_UP / UNHEALTHY)', async () => {
    instanceRow = { status: 'provisioning' };
    expect((await getProjectServices(REF)).services.every((s) => s.status === 'COMING_UP')).toBe(
      true,
    );
    instanceRow = { status: 'paused' };
    expect((await getProjectServices(REF)).services.every((s) => s.status === 'UNHEALTHY')).toBe(
      true,
    );
  });
});

describe('FALLBACK_TAGS drift guard', () => {
  it('every fallback tag equals the supabase-template pin (never goes stale)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const template = fs.readFileSync(
      path.join(here, '../../../../infra/supabase-template/docker-compose.yml'),
      'utf8',
    );
    for (const [svc, repo] of Object.entries(SERVICE_IMAGE_REPO)) {
      // repos contain only `/` as a regex-special char
      const m = template.match(new RegExp('image:\\s*' + repo.replace(/\//g, '\\/') + ':(\\S+)'));
      expect(m, `template has no image line for ${repo}`).toBeTruthy();
      expect(FALLBACK_TAGS[svc], `FALLBACK_TAGS.${svc} drifted from template`).toBe(m![1]);
    }
  });
});

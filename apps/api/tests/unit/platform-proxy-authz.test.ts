/**
 * SEC-001 regression — org-scoped authorization for the platform proxy.
 *
 * `authorizeAndResolveInstance` is the chokepoint every /platform/* proxy path
 * now goes through. It MUST:
 *   - return the instance (with the decrypted service-role key) only when the
 *     caller is a member of the project's org AND their role allows the action;
 *   - throw ProxyProjectNotFoundError when the caller is NOT a member or the ref
 *     is unknown (→ 404, no cross-tenant existence leak — the IDOR fix);
 *   - throw forbidden when the caller is a member but their role lacks the action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// One configurable DB row (the supabaseInstances ⋈ organizationMembers join result).
let joinRow:
  | { portKong: number; status: string; encryptedSecrets: Buffer; role: string }
  | undefined;

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => (joinRow ? [joinRow] : []) }),
        }),
      }),
    }),
  }),
  schema: {
    supabaseInstances: {
      ref: 'ref',
      orgId: 'orgId',
      portKong: 'portKong',
      status: 'status',
      encryptedSecrets: 'enc',
    },
    organizationMembers: { organizationId: 'organizationId', userId: 'userId', role: 'role' },
  },
}));

vi.mock('@supastack/crypto', () => ({
  loadMasterKey: () => Buffer.alloc(32),
  decryptJson: () => ({
    serviceRoleKey: 'svc-key',
    dashboardPassword: 'dp',
    logflarePrivateAccessToken: 'lpat',
  }),
}));

const { authorizeAndResolveInstance, ProxyProjectNotFoundError, ProxyProjectPausedError } =
  await import('../../src/services/platform-proxy-helpers.js');

// Minimal fake app/req — requireAuth returns a fixed user.
const app = { requireAuth: () => ({ id: 'user-1' }) } as never;
const req = {} as never;

beforeEach(() => {
  joinRow = {
    portKong: 9999,
    status: 'running',
    encryptedSecrets: Buffer.alloc(1),
    role: 'developer',
  };
});

describe('authorizeAndResolveInstance — SEC-001 cross-tenant IDOR fix', () => {
  it('non-member / unknown ref → ProxyProjectNotFoundError (404, no existence leak)', async () => {
    joinRow = undefined; // the membership join returns no row
    await expect(
      authorizeAndResolveInstance(app, req, 'instance.read', 'other-org-ref'),
    ).rejects.toBeInstanceOf(ProxyProjectNotFoundError);
  });

  it('member with sufficient role → returns the instance + decrypted service-role key', async () => {
    joinRow!.role = 'developer';
    const inst = await authorizeAndResolveInstance(app, req, 'database.write', 'ref1');
    expect(inst.serviceRoleKey).toBe('svc-key');
    expect(inst.portKong).toBe(9999);
  });

  it('member whose role lacks the action → forbidden (read_only cannot database.write)', async () => {
    joinRow!.role = 'read_only';
    await expect(
      authorizeAndResolveInstance(app, req, 'database.write', 'ref1'),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('read_only member CAN read (instance.read) — members keep read access', async () => {
    joinRow!.role = 'read_only';
    const inst = await authorizeAndResolveInstance(app, req, 'instance.read', 'ref1');
    expect(inst.portKong).toBe(9999);
  });

  it('paused project → ProxyProjectPausedError (503)', async () => {
    joinRow!.status = 'paused';
    await expect(
      authorizeAndResolveInstance(app, req, 'instance.read', 'ref1'),
    ).rejects.toBeInstanceOf(ProxyProjectPausedError);
  });
});

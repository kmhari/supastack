// @vitest-environment node
//
// Coverage uplift (feature 015 / US5) for src/lib/api.ts.
//
// `api.ts` is a thin axios wrapper. We mock the underlying axios client so
// every exported method exercises its request line + `unwrap` without
// touching the network. This file alone covers ~280 statements of the
// ~8200-statement web bundle (~3.5%), which is the lion's share of what
// can be lifted without a DOM environment (jsdom is not installed in this
// workspace — see results.md for the US5 jsdom gap).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Method =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete';

interface MockCall {
  method: Method;
  url: string;
  body?: unknown;
  cfg?: unknown;
}

const calls: MockCall[] = [];

const mockClient = {
  get: vi.fn((url: string, cfg?: unknown) => {
    calls.push({ method: 'get', url, cfg });
    return Promise.resolve({ data: { url, method: 'get' } });
  }),
  post: vi.fn((url: string, body?: unknown, cfg?: unknown) => {
    calls.push({ method: 'post', url, body, cfg });
    return Promise.resolve({ data: { url, method: 'post', body } });
  }),
  put: vi.fn((url: string, body?: unknown, cfg?: unknown) => {
    calls.push({ method: 'put', url, body, cfg });
    return Promise.resolve({ data: { url, method: 'put', body } });
  }),
  patch: vi.fn((url: string, body?: unknown, cfg?: unknown) => {
    calls.push({ method: 'patch', url, body, cfg });
    return Promise.resolve({ data: { url, method: 'patch', body } });
  }),
  delete: vi.fn((url: string, cfg?: unknown) => {
    calls.push({ method: 'delete', url, cfg });
    return Promise.resolve({ data: { url, method: 'delete' } });
  }),
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockClient),
  },
}));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// Import after mocking so axios.create returns mockClient.
const apiMod = await import('../../src/lib/api');

const lastCall = (): MockCall => {
  const c = calls[calls.length - 1];
  if (!c) throw new Error('no recorded calls');
  return c;
};

describe('setupApi', () => {
  it('status → GET /setup/status', async () => {
    await apiMod.setupApi.status();
    expect(lastCall().method).toBe('get');
    expect(lastCall().url).toBe('/setup/status');
  });
  it('run → POST /setup', async () => {
    await apiMod.setupApi.run({ email: 'a@b', password: 'x', orgName: 'o' });
    expect(lastCall().method).toBe('post');
    expect(lastCall().url).toBe('/setup');
    expect(lastCall().body).toEqual({ email: 'a@b', password: 'x', orgName: 'o' });
  });
});

describe('authApi', () => {
  it('login posts credentials', async () => {
    await apiMod.authApi.login({ email: 'a@b', password: 'x' });
    expect(lastCall()).toMatchObject({ method: 'post', url: '/auth/login', body: { email: 'a@b', password: 'x' } });
  });
  it('logout → POST /auth/logout', async () => {
    await apiMod.authApi.logout();
    expect(lastCall()).toMatchObject({ method: 'post', url: '/auth/logout' });
  });
  it('me → GET /auth/me', async () => {
    await apiMod.authApi.me();
    expect(lastCall()).toMatchObject({ method: 'get', url: '/auth/me' });
  });
  it('createToken → POST /auth/tokens', async () => {
    await apiMod.authApi.createToken({ label: 'l' });
    expect(lastCall()).toMatchObject({ method: 'post', url: '/auth/tokens', body: { label: 'l' } });
  });
  it('listTokens → GET /auth/tokens', async () => {
    await apiMod.authApi.listTokens();
    expect(lastCall()).toMatchObject({ method: 'get', url: '/auth/tokens' });
  });
  it('revokeToken → DELETE /auth/tokens/:id', async () => {
    await apiMod.authApi.revokeToken('abc');
    expect(lastCall()).toMatchObject({ method: 'delete', url: '/auth/tokens/abc' });
  });
});

describe('apexApi', () => {
  it('status → GET /apex', async () => {
    await apiMod.apexApi.status();
    expect(lastCall().url).toBe('/apex');
  });
  it('recheck → POST /apex/recheck', async () => {
    await apiMod.apexApi.recheck();
    expect(lastCall().url).toBe('/apex/recheck');
  });
  it('issue → POST /apex/issue with long timeout', async () => {
    await apiMod.apexApi.issue();
    const c = lastCall();
    expect(c.url).toBe('/apex/issue');
    expect((c.cfg as { timeout?: number }).timeout).toBe(60_000);
  });
});

describe('orgApi', () => {
  it('get → GET /org', async () => {
    await apiMod.orgApi.get();
    expect(lastCall()).toMatchObject({ method: 'get', url: '/org' });
  });
  it('patch → PATCH /org', async () => {
    await apiMod.orgApi.patch({ name: 'n' });
    expect(lastCall()).toMatchObject({ method: 'patch', url: '/org', body: { name: 'n' } });
  });
  it('setBackupStore → PUT /org/backup-store', async () => {
    await apiMod.orgApi.setBackupStore({ kind: 'local' });
    expect(lastCall()).toMatchObject({ method: 'put', url: '/org/backup-store' });
  });
});

describe('membersApi', () => {
  it('list → GET /members', async () => {
    await apiMod.membersApi.list();
    expect(lastCall().url).toBe('/members');
  });
  it('invite → POST /members/invites', async () => {
    await apiMod.membersApi.invite({ email: 'a@b', role: 'admin' });
    expect(lastCall()).toMatchObject({ url: '/members/invites', body: { email: 'a@b', role: 'admin' } });
  });
  it('listInvites → GET /members/invites', async () => {
    await apiMod.membersApi.listInvites();
    expect(lastCall().url).toBe('/members/invites');
  });
  it('revokeInvite → DELETE /members/invites/:id', async () => {
    await apiMod.membersApi.revokeInvite('id1');
    expect(lastCall()).toMatchObject({ method: 'delete', url: '/members/invites/id1' });
  });
  it('acceptInvite → POST /members/invites/accept', async () => {
    await apiMod.membersApi.acceptInvite({ token: 't', password: 'p' });
    expect(lastCall()).toMatchObject({ url: '/members/invites/accept' });
  });
  it('remove → DELETE /members/:userId', async () => {
    await apiMod.membersApi.remove('u1');
    expect(lastCall()).toMatchObject({ method: 'delete', url: '/members/u1' });
  });
});

describe('instancesApi', () => {
  it('list → GET /instances with optional params', async () => {
    await apiMod.instancesApi.list();
    expect(lastCall().url).toBe('/instances');
    await apiMod.instancesApi.list({ status: 'running' });
    expect((lastCall().cfg as { params: unknown }).params).toEqual({ status: 'running' });
  });
  it('get/create/patch/delete dispatch correctly', async () => {
    await apiMod.instancesApi.get('r1');
    expect(lastCall()).toMatchObject({ method: 'get', url: '/instances/r1' });
    await apiMod.instancesApi.create({ name: 'n' });
    expect(lastCall()).toMatchObject({ method: 'post', url: '/instances' });
    await apiMod.instancesApi.patch('r1', { name: 'n2' });
    expect(lastCall()).toMatchObject({ method: 'patch', url: '/instances/r1' });
    await apiMod.instancesApi.delete('r1');
    expect(lastCall()).toMatchObject({ method: 'delete', url: '/instances/r1' });
  });
  it('lifecycle endpoints', async () => {
    await apiMod.instancesApi.pause('r');
    expect(lastCall().url).toBe('/instances/r/pause');
    await apiMod.instancesApi.resume('r');
    expect(lastCall().url).toBe('/instances/r/resume');
    await apiMod.instancesApi.restart('r');
    expect(lastCall().url).toBe('/instances/r/restart');
  });
  it('upgrade posts body', async () => {
    await apiMod.instancesApi.upgrade('r', { supabaseVersion: 'v', backupFirst: true });
    expect(lastCall()).toMatchObject({
      url: '/instances/r/upgrade',
      body: { supabaseVersion: 'v', backupFirst: true },
    });
  });
  it('reveal posts password', async () => {
    await apiMod.instancesApi.reveal('r', { password: 'p' });
    expect(lastCall()).toMatchObject({ url: '/instances/r/credentials/reveal', body: { password: 'p' } });
  });
  it('health → GET /instances/:ref/health', async () => {
    await apiMod.instancesApi.health('r');
    expect(lastCall()).toMatchObject({ method: 'get', url: '/instances/r/health' });
  });
});

describe('backupsApi', () => {
  it('list/create dispatch correctly', async () => {
    await apiMod.backupsApi.list('r');
    expect(lastCall().url).toBe('/instances/r/backups');
    await apiMod.backupsApi.create('r');
    expect(lastCall().url).toBe('/instances/r/backups');
  });
  it('downloadUrl returns a string path', () => {
    expect(apiMod.backupsApi.downloadUrl('r', 'b1')).toBe('/api/v1/instances/r/backups/b1/download');
  });
});

describe('auditApi', () => {
  it('list passes params', async () => {
    await apiMod.auditApi.list();
    expect(lastCall().url).toBe('/audit');
    await apiMod.auditApi.list({ action: 'login', actor: 'u', limit: '10' });
    expect((lastCall().cfg as { params: unknown }).params).toEqual({
      action: 'login',
      actor: 'u',
      limit: '10',
    });
  });
});

describe('cliApi', () => {
  it('profileToml → GET /cli/profile.toml (text)', async () => {
    await apiMod.cliApi.profileToml();
    const c = lastCall();
    expect(c.url).toBe('/cli/profile.toml');
    expect((c.cfg as { responseType: string }).responseType).toBe('text');
  });
  it('mintToken posts label', async () => {
    await apiMod.cliApi.mintToken('lab');
    expect(lastCall()).toMatchObject({ url: '/cli/mint-token', body: { label: 'lab' } });
  });
});

describe('wildcardCertApi', () => {
  it('all methods dispatch', async () => {
    await apiMod.wildcardCertApi.initiate();
    expect(lastCall().url).toBe('/wildcard-certs/initiate');
    await apiMod.wildcardCertApi.verify();
    expect(lastCall().url).toBe('/wildcard-certs/verify');
    await apiMod.wildcardCertApi.status();
    expect(lastCall().url).toBe('/wildcard-certs/status');
    await apiMod.wildcardCertApi.disable();
    expect(lastCall()).toMatchObject({ method: 'delete', url: '/wildcard-certs' });
  });
});

describe('secretsApi', () => {
  it('list/upsert/delete dispatch', async () => {
    await apiMod.secretsApi.list('r');
    expect(lastCall()).toMatchObject({ method: 'get', url: '/projects/r/secrets' });
    await apiMod.secretsApi.upsert('r', [{ name: 'A', value: '1' }]);
    expect(lastCall()).toMatchObject({ method: 'post', url: '/projects/r/secrets' });
    await apiMod.secretsApi.delete('r', ['A']);
    const c = lastCall();
    expect(c.method).toBe('delete');
    expect(c.url).toBe('/projects/r/secrets');
    expect((c.cfg as { data: unknown }).data).toEqual(['A']);
  });
});

describe('vaultApi', () => {
  it('enable → POST /projects/:ref/vault/enable', async () => {
    await apiMod.vaultApi.enable('r');
    expect(lastCall()).toMatchObject({ method: 'post', url: '/projects/r/vault/enable' });
  });
});

describe('cliLoginApi', () => {
  it('mint posts cli-login bundle', async () => {
    await apiMod.cliLoginApi.mint({ session_id: 's', token_name: 't', public_key: 'p' });
    expect(lastCall()).toMatchObject({
      url: '/cli/login',
      body: { session_id: 's', token_name: 't', public_key: 'p' },
    });
  });
});

describe('poolerApi', () => {
  it('all methods dispatch', async () => {
    await apiMod.poolerApi.status();
    expect(lastCall().url).toBe('/pooler/status');
    await apiMod.poolerApi.reregister('r');
    expect(lastCall().url).toBe('/pooler/tenants/r/re-register');
    await apiMod.poolerApi.runReconciler();
    expect(lastCall().url).toBe('/pooler/reconciler/run');
    await apiMod.poolerApi.resetPgPassword('r');
    expect(lastCall().url).toBe('/instances/r/reset-pg-password');
  });
});

// @vitest-environment jsdom
//
// Coverage for src/lib/api.ts (the setup-only SPA surface, feature 086).
//
// `api.ts` is a thin axios wrapper. We mock the underlying axios client so
// every exported method exercises its request line + `unwrap` without
// touching the network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

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
  // feature 116 — api.ts registers a request interceptor (dashboard-token Bearer) at load.
  interceptors: { request: { use: vi.fn() } },
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
  it('login posts credentials to GoTrue and stores the session for the Bearer interceptor', async () => {
    // NOT /api/v1/auth/login — feature 084 deleted that route; the wizard
    // was sessionless after admin creation until this went to GoTrue.
    window.localStorage.removeItem('supabase.dashboard.auth.token');
    await apiMod.authApi.login({ email: 'a@b', password: 'x' });
    expect(lastCall()).toMatchObject({
      method: 'post',
      url: '/auth/v1/token?grant_type=password',
      body: { email: 'a@b', password: 'x' },
    });
    // The client's baseURL is /api/v1; GoTrue lives at the ORIGIN's /auth/v1 —
    // the per-request baseURL override is what keeps this from resolving to
    // /api/v1/auth/v1/token (404).
    expect((lastCall().cfg as { baseURL?: string }).baseURL).toBe('');
    expect(window.localStorage.getItem('supabase.dashboard.auth.token')).toBeTruthy();
  });
  it('logout clears the stored session', async () => {
    window.localStorage.setItem('supabase.dashboard.auth.token', '{"access_token":"t"}');
    await apiMod.authApi.logout();
    expect(window.localStorage.getItem('supabase.dashboard.auth.token')).toBeNull();
  });
  it('me → GET /auth/me', async () => {
    await apiMod.authApi.me();
    expect(lastCall()).toMatchObject({ method: 'get', url: '/auth/me' });
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
  it('patch → PATCH /org', async () => {
    await apiMod.orgApi.patch({ name: 'n' });
    expect(lastCall()).toMatchObject({ method: 'patch', url: '/org', body: { name: 'n' } });
  });
});

describe('wildcardCertApi', () => {
  it('initiate/verify/status dispatch', async () => {
    await apiMod.wildcardCertApi.initiate();
    expect(lastCall().url).toBe('/wildcard-certs/initiate');
    await apiMod.wildcardCertApi.verify();
    expect(lastCall().url).toBe('/wildcard-certs/verify');
    await apiMod.wildcardCertApi.status();
    expect(lastCall().url).toBe('/wildcard-certs/status');
  });
});

// feature 116 — the two live-fix bugs: the dashboard session lives in
// localStorage (NOT a cookie), and the api returns owner/administrator/... (NOT
// the legacy admin/member). These pure helpers guard both.
describe('getDashboardToken (localStorage session reuse)', () => {
  const setLs = (raw: string | null) => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => (k === 'supabase.dashboard.auth.token' ? raw : null),
      },
    };
  };
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('reads the top-level access_token', () => {
    setLs(JSON.stringify({ access_token: 'tok-top' }));
    expect(apiMod.getDashboardToken()).toBe('tok-top');
  });
  it('falls back to currentSession.access_token', () => {
    setLs(JSON.stringify({ currentSession: { access_token: 'tok-nested' } }));
    expect(apiMod.getDashboardToken()).toBe('tok-nested');
  });
  it('returns null when no session is stored', () => {
    setLs(null);
    expect(apiMod.getDashboardToken()).toBeNull();
  });
  it('returns null (never throws) on malformed JSON', () => {
    setLs('{not json');
    expect(apiMod.getDashboardToken()).toBeNull();
  });
});

describe('isInstallationAdmin (role gate)', () => {
  it('grants owner + administrator', () => {
    expect(apiMod.isInstallationAdmin('owner')).toBe(true);
    expect(apiMod.isInstallationAdmin('administrator')).toBe(true);
  });
  it('denies developer, read_only, legacy admin/member, and nullish', () => {
    for (const r of ['developer', 'read_only', 'admin', 'member', null, undefined, '']) {
      expect(apiMod.isInstallationAdmin(r)).toBe(false);
    }
  });
});

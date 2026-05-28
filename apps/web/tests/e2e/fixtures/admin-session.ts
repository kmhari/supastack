import { test as base, type BrowserContext, type Browser, expect } from '@playwright/test';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Admin-session Playwright fixture.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md FR-002
 * Plan: specs/021-dashboard-browser-tests/plan.md §A3
 * Data model: specs/021-dashboard-browser-tests/data-model.md §4
 * Task: T006 + T013 (admin user seed branch)
 *
 * Provides `adminContext`: a BrowserContext pre-authenticated as a seeded
 * admin user. First-run logic per T013:
 *   1. Try to load `storageState.json` (cached login session); use if valid
 *   2. Otherwise, attempt to login via POST /api/v1/auth/login
 *   3. On 401 (no admin yet), POST /api/v1/setup to bootstrap, then login
 *   4. Persist cookies to storageState.json for next run
 */

// Allow overrides via env so the suite can run against a deployed environment
// (e.g. supaviser.dev) with the operator's real credentials, without needing
// the in-source defaults to change.
export const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? 'admin@test.local';
export const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? 'hunter2hunter2';
const ORG_NAME = process.env.PLAYWRIGHT_ORG_NAME ?? 'e2e';
const APEX_DOMAIN = process.env.PLAYWRIGHT_APEX_DOMAIN ?? 'test.local';

const STORAGE_STATE_PATH = resolve(process.cwd(), 'tests/e2e/.auth/admin-storage-state.json');

interface Fixtures {
  adminContext: BrowserContext;
  memberContext: BrowserContext;
}

const MEMBER_EMAIL = 'member@test.local';
const MEMBER_PASSWORD = 'memberpass1234';
const MEMBER_STORAGE_STATE_PATH = resolve(
  process.cwd(),
  'tests/e2e/.auth/member-storage-state.json',
);

export const test = base.extend<Fixtures>({
  adminContext: async ({ browser, baseURL }, use) => {
    const stateFile = await loadOrCreateAdminStorageState(baseURL ?? 'http://localhost:5173');
    const ctx = await browser.newContext({ storageState: stateFile });
    await use(ctx);
    await ctx.close();
  },
  memberContext: async ({ browser, baseURL }, use) => {
    const apiBase = baseURL ?? 'http://localhost:5173';
    const stateFile = await loadOrCreateMemberStorageState(browser, apiBase);
    const ctx = await browser.newContext({ storageState: stateFile });
    await use(ctx);
    await ctx.close();
  },
});

export { expect };

/**
 * Returns the path to a `storageState.json` containing a valid admin session
 * cookie. Creates one if missing — running `/setup` first if the stack is
 * fresh.
 */
async function loadOrCreateAdminStorageState(apiBaseUrl: string): Promise<string> {
  if (await fileExists(STORAGE_STATE_PATH)) {
    return STORAGE_STATE_PATH;
  }

  await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true });

  // Try login first — works when the stack already has the admin user seeded.
  let cookies = await tryLogin(apiBaseUrl);
  if (!cookies) {
    await seedAdmin(apiBaseUrl);
    cookies = await tryLogin(apiBaseUrl);
  }
  if (!cookies) {
    throw new Error(
      `Could not obtain admin session against ${apiBaseUrl}. ` +
        `Verify the api is running and /setup was either pre-seeded or accepts a new admin.`,
    );
  }

  // Playwright's storageState.json shape:
  const storageState = {
    cookies,
    origins: [] as unknown[],
  };
  await writeFile(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2), 'utf8');
  return STORAGE_STATE_PATH;
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
}

async function tryLogin(apiBaseUrl: string): Promise<PlaywrightCookie[] | null> {
  const resp = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }).catch(() => null);
  if (!resp || !resp.ok) return null;

  const setCookies = resp.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) return null;

  const host = new URL(apiBaseUrl).hostname;
  const out: PlaywrightCookie[] = [];
  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw, host);
    if (parsed) out.push(parsed);
  }
  return out.length > 0 ? out : null;
}

async function seedAdmin(apiBaseUrl: string): Promise<void> {
  const resp = await fetch(`${apiBaseUrl}/api/v1/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      orgName: ORG_NAME,
      apexDomain: APEX_DOMAIN,
    }),
  });
  if (!resp.ok && resp.status !== 410) {
    throw new Error(`Could not seed admin via /setup — got HTTP ${resp.status} ${resp.statusText}`);
  }
}

function parseSetCookie(raw: string, host: string): PlaywrightCookie | null {
  // Minimal parser sufficient for our session cookie. Handles `name=value;
  // Path=...; HttpOnly; SameSite=Lax`.
  const [head, ...attrs] = raw.split(';').map((s) => s.trim());
  if (!head) return null;
  const eqIdx = head.indexOf('=');
  if (eqIdx < 0) return null;
  const name = head.slice(0, eqIdx);
  const value = head.slice(eqIdx + 1);

  let path = '/';
  let expires = -1;
  let httpOnly = false;
  let secure = false;
  let sameSite: 'Lax' | 'Strict' | 'None' = 'Lax';
  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower.startsWith('path=')) path = attr.slice(5);
    else if (lower === 'httponly') httpOnly = true;
    else if (lower === 'secure') secure = true;
    else if (lower.startsWith('samesite=')) {
      const v = attr.slice(9).toLowerCase();
      sameSite = v === 'strict' ? 'Strict' : v === 'none' ? 'None' : 'Lax';
    } else if (lower.startsWith('max-age=')) {
      expires = Math.floor(Date.now() / 1000) + Number(attr.slice(8));
    }
  }
  return { name, value, domain: host, path, expires, httpOnly, secure, sameSite };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Returns the path to a `storageState.json` containing a valid MEMBER (non-admin)
 * session cookie. Bootstraps the member on first call by having the admin invite
 * them, then accepting the invite programmatically via the same flow the
 * dashboard's invite-acceptance page uses.
 *
 * Task: T016
 */
async function loadOrCreateMemberStorageState(_browser: Browser, apiBase: string): Promise<string> {
  if (await fileExists(MEMBER_STORAGE_STATE_PATH)) {
    return MEMBER_STORAGE_STATE_PATH;
  }
  await mkdir(dirname(MEMBER_STORAGE_STATE_PATH), { recursive: true });

  // Try login first — the member may already exist from a prior run that
  // wiped only the storage-state cache.
  let cookies = await tryLoginAs(apiBase, MEMBER_EMAIL, MEMBER_PASSWORD);
  if (!cookies) {
    await inviteAndAcceptMember(apiBase);
    cookies = await tryLoginAs(apiBase, MEMBER_EMAIL, MEMBER_PASSWORD);
  }
  if (!cookies) {
    throw new Error(`Could not obtain member session against ${apiBase}.`);
  }

  const storageState = { cookies, origins: [] as unknown[] };
  await writeFile(MEMBER_STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2), 'utf8');
  return MEMBER_STORAGE_STATE_PATH;
}

async function inviteAndAcceptMember(apiBase: string): Promise<void> {
  // Use the admin cookie jar to invite. (We don't depend on the admin
  // storageState file existing in advance — fall back to a fresh login.)
  const adminCookieHeader = await getAdminCookieHeader(apiBase);

  const inviteResp = await fetch(`${apiBase}/api/v1/members/invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookieHeader,
    },
    body: JSON.stringify({ email: MEMBER_EMAIL, role: 'member' }),
  });
  if (!inviteResp.ok && inviteResp.status !== 409) {
    throw new Error(`Could not invite member: HTTP ${inviteResp.status} ${inviteResp.statusText}`);
  }

  // The invite token lives inside the `link` field as ?token=... — extract it.
  let token: string | null = null;
  if (inviteResp.ok) {
    const body = (await inviteResp.json()) as { link?: string };
    const m = body.link?.match(/token=([a-f0-9]+)/i);
    token = m?.[1] ?? null;
  }
  if (!token) {
    // Already invited (409) OR link parsing failed. We can't accept without a
    // fresh token, so try to find an open invite via the list endpoint.
    const listResp = await fetch(`${apiBase}/api/v1/members/invites`, {
      headers: { Cookie: adminCookieHeader },
    });
    if (listResp.ok) {
      // We can't recover the raw token from a previously-issued invite (the
      // server only logs it once). Revoke + reinvite.
      const list = (await listResp.json()) as Array<{ id: string; email: string }>;
      const stale = list.find((i) => i.email === MEMBER_EMAIL);
      if (stale) {
        await fetch(`${apiBase}/api/v1/members/invites/${stale.id}`, {
          method: 'DELETE',
          headers: { Cookie: adminCookieHeader },
        });
      }
    }
    // Re-invite to get a fresh token.
    const reResp = await fetch(`${apiBase}/api/v1/members/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookieHeader,
      },
      body: JSON.stringify({ email: MEMBER_EMAIL, role: 'member' }),
    });
    if (!reResp.ok) {
      throw new Error(`Could not re-invite member: HTTP ${reResp.status} ${reResp.statusText}`);
    }
    const body = (await reResp.json()) as { link?: string };
    const m = body.link?.match(/token=([a-f0-9]+)/i);
    token = m?.[1] ?? null;
  }
  if (!token) {
    throw new Error('Could not extract invite token from invite response');
  }

  const acceptResp = await fetch(`${apiBase}/api/v1/members/invites/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: MEMBER_PASSWORD }),
  });
  if (!acceptResp.ok) {
    throw new Error(`Could not accept invite: HTTP ${acceptResp.status} ${acceptResp.statusText}`);
  }
}

async function tryLoginAs(
  apiBase: string,
  email: string,
  password: string,
): Promise<PlaywrightCookie[] | null> {
  const resp = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);
  if (!resp || !resp.ok) return null;
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) return null;
  const host = new URL(apiBase).hostname;
  return setCookies.map((raw) => parseSetCookie(raw, host)).filter(Boolean) as PlaywrightCookie[];
}

async function getAdminCookieHeader(apiBase: string): Promise<string> {
  const cookies = await tryLoginAs(apiBase, ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!cookies) {
    throw new Error('Could not obtain admin cookies for invite flow');
  }
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

// Suppress unused-import lint when consumers re-import readFile etc.
void readFile;

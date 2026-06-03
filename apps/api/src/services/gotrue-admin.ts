/**
 * Server-side GoTrue admin client (feature 084).
 *
 * Mints a short-lived `service_role` JWT (HS256, signed with the same
 * HKDF-derived secret GoTrue uses) and calls GoTrue's admin + email endpoints.
 * Identity writes go through GoTrue (single source of truth); supastack owns the
 * authorization records (organization_members) separately.
 */
import { createHmac } from 'node:crypto';
import { deriveGotrueJwtSecret, loadMasterKey } from '@supastack/crypto';

const GOTRUE_URL = process.env.GOTRUE_INTERNAL_URL ?? 'http://auth:9999';
const SERVICE_ROLE_TTL_SEC = 300;

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

/** Mint a short-lived service_role JWT GoTrue accepts on /admin/*. */
function signServiceRoleJwt(): string {
  const secret = deriveGotrueJwtSecret(loadMasterKey());
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      role: 'service_role',
      aud: 'authenticated',
      iss: 'supastack',
      iat: now,
      exp: now + SERVICE_ROLE_TTL_SEC,
    }),
  );
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signServiceRoleJwt()}`, 'content-type': 'application/json' };
}

export interface GotrueUser {
  id: string;
  email: string;
}

interface GotrueUserResponse {
  id: string;
  email: string;
}

/** Create a GoTrue user (admin). `emailConfirm` defaults true (operator/invite-created). */
export async function createGotrueUser(opts: {
  email: string;
  password?: string;
  emailConfirm?: boolean;
}): Promise<GotrueUser> {
  const res = await fetch(`${GOTRUE_URL}/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      email: opts.email,
      password: opts.password,
      email_confirm: opts.emailConfirm ?? true,
    }),
  });
  if (!res.ok) {
    throw new Error(`gotrue createUser failed (${res.status}): ${await res.text()}`);
  }
  const u = (await res.json()) as GotrueUserResponse;
  return { id: u.id, email: u.email };
}

/** Look up a GoTrue user by email (admin list + filter). Returns null if absent. */
export async function getGotrueUserByEmail(email: string): Promise<GotrueUser | null> {
  const res = await fetch(`${GOTRUE_URL}/admin/users?page=1&per_page=200`, {
    headers: adminHeaders(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { users?: GotrueUserResponse[] };
  const match = (data.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match ? { id: match.id, email: match.email } : null;
}

/** Idempotently ensure a GoTrue user exists for `email`; returns it. */
export async function ensureGotrueUser(opts: {
  email: string;
  password?: string;
  emailConfirm?: boolean;
}): Promise<GotrueUser> {
  const existing = await getGotrueUserByEmail(opts.email);
  if (existing) return existing;
  return createGotrueUser(opts);
}

/** Send a password-recovery email via GoTrue (requires SMTP configured). */
export async function sendRecoveryEmail(email: string): Promise<void> {
  const res = await fetch(`${GOTRUE_URL}/recover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    throw new Error(`gotrue recover failed (${res.status}): ${await res.text()}`);
  }
}

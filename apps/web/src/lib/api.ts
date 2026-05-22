import axios, { type AxiosInstance } from 'axios';

// CRITICAL: VITE_API_URL defaults to '' so axios uses relative /api paths.
// Never bake "http://localhost:3001" into the client bundle (Multibase mistake).
//
// In dev: Vite proxies /api to the backend.
// In prod: Caddy proxies /api/* to the api container.
const BASE: string =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? '';

const client: AxiosInstance = axios.create({
  baseURL: `${BASE}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // session cookies
});

const unwrap = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);

// ─── auth + setup ───────────────────────────────────────────────────────────
export const setupApi = {
  status: () => unwrap<{ open: boolean }>(client.get('/setup/status')),
  run: (body: { email: string; password: string; orgName: string; apexDomain?: string }) =>
    unwrap<{ userId: string; orgId: string; apiToken: string }>(client.post('/setup', body)),
};

export const authApi = {
  login: (body: { email: string; password: string }) => unwrap(client.post('/auth/login', body)),
  logout: () => unwrap(client.post('/auth/logout')),
  me: () =>
    unwrap<{ userId: string; email: string; role: 'admin' | 'member' }>(client.get('/auth/me')),
  createToken: (body: { label: string }) =>
    unwrap<{ id: string; token: string; label: string }>(client.post('/auth/tokens', body)),
  listTokens: () => unwrap(client.get('/auth/tokens')),
  revokeToken: (id: string) => unwrap(client.delete(`/auth/tokens/${id}`)),
};

// ─── apex domain + TLS status (setup wizard step 2) ─────────────────────────
export interface ApexCert {
  reachable: boolean;
  issued: boolean;
  issuer?: string;
  subject?: string;
  notAfter?: string;
  selfSigned?: boolean;
  error?: string;
}
export interface ApexStatus {
  apex: string | null;
  expectedIp: string | null;
  observedIps: string[];
  dnsResolved: boolean;
  cert: ApexCert | null;
}
export const apexApi = {
  status: () => unwrap<ApexStatus>(client.get('/apex')),
  recheck: () => unwrap<ApexStatus>(client.post('/apex/recheck')),
  // Long-poll (~45s on the server). Triggers Caddy on-demand TLS from
  // inside the docker network and returns once the cert is issued or
  // the issue budget runs out.
  issue: () => unwrap<ApexStatus>(client.post('/apex/issue', null, { timeout: 60_000 })),
};

// ─── org + members ──────────────────────────────────────────────────────────
export const orgApi = {
  get: () => unwrap(client.get('/org')),
  patch: (body: { name?: string; apexDomain?: string }) => unwrap(client.patch('/org', body)),
  setBackupStore: (body: unknown) => unwrap(client.put('/org/backup-store', body)),
};

export const membersApi = {
  list: () => unwrap(client.get('/members')),
  invite: (body: { email: string; role: 'admin' | 'member' }) =>
    unwrap(client.post('/members/invites', body)),
  listInvites: () => unwrap(client.get('/members/invites')),
  revokeInvite: (id: string) => unwrap(client.delete(`/members/invites/${id}`)),
  acceptInvite: (body: { token: string; password: string }) =>
    unwrap(client.post('/members/invites/accept', body)),
  remove: (userId: string) => unwrap(client.delete(`/members/${userId}`)),
};

// ─── instances ──────────────────────────────────────────────────────────────
export const instancesApi = {
  list: (params?: { status?: string }) => unwrap(client.get('/instances', { params })),
  get: (ref: string) => unwrap(client.get(`/instances/${ref}`)),
  create: (body: unknown) => unwrap(client.post('/instances', body)),
  patch: (ref: string, body: unknown) => unwrap(client.patch(`/instances/${ref}`, body)),
  delete: (ref: string) => unwrap(client.delete(`/instances/${ref}`)),
  pause: (ref: string) => unwrap(client.post(`/instances/${ref}/pause`)),
  resume: (ref: string) => unwrap(client.post(`/instances/${ref}/resume`)),
  restart: (ref: string) => unwrap(client.post(`/instances/${ref}/restart`)),
  upgrade: (ref: string, body: { supabaseVersion: string; backupFirst?: boolean }) =>
    unwrap(client.post(`/instances/${ref}/upgrade`, body)),
  reveal: (ref: string, body: { password: string }) =>
    unwrap(client.post(`/instances/${ref}/credentials/reveal`, body)),
};

// ─── backups ────────────────────────────────────────────────────────────────
export const backupsApi = {
  list: (ref: string) => unwrap(client.get(`/instances/${ref}/backups`)),
  create: (ref: string) => unwrap(client.post(`/instances/${ref}/backups`)),
  downloadUrl: (ref: string, id: string) =>
    `${BASE}/api/v1/instances/${ref}/backups/${id}/download`,
};

// ─── audit ──────────────────────────────────────────────────────────────────
export const auditApi = {
  list: (params?: {
    action?: string;
    actor?: string;
    since?: string;
    until?: string;
    cursor?: string;
    limit?: string;
  }) => unwrap(client.get('/audit', { params })),
};

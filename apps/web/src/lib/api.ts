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

// ─── OAuth MCP clients (feature 014 US3) ────────────────────────────────────
export interface OAuthClientRow {
  client_id: string;
  client_name: string;
  authorized_at: string;
  last_used_at: string;
  scope: string;
}
export const oauthApi = {
  listClients: () => unwrap<OAuthClientRow[]>(client.get('/oauth/clients')),
  revokeClient: (clientId: string) =>
    unwrap<{ revoked: number; blacklisted_jtis: number }>(
      client.delete(`/oauth/clients/${clientId}`),
    ),
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
  wildcardObservedIps: string[];
  wildcardResolved: boolean;
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
  health: (ref: string) => unwrap(client.get(`/instances/${ref}/health`)),
};

// ─── auth-config (feature 020 — auth providers dashboard) ───────────────────
//
// Dashboard talks to the Management API surface via the same `/api/v1` prefix
// used by every other dashboard call (Caddy routes `/api/*` to the api;
// `/v1/*` is reserved for the CLI-compat host at `api.<apex>`). The api
// registers `authConfigRoutes` twice — once at `/v1/...` for the CLI and
// once at `/api/v1/...` for the dashboard — so the wire shape is identical.
export type FieldStatusEntry =
  | { status: 'honored'; envName: string; secret?: boolean }
  | { status: 'stored_only'; reason: string }
  | { status: 'unsupported'; reason: string };

export interface AuthConfigResponse {
  [field: string]: unknown;
  _selfbase?: { fieldStatus: Record<string, FieldStatusEntry> };
}

export const authConfigApi = {
  get: (ref: string) =>
    unwrap<AuthConfigResponse>(client.get(`/projects/${ref}/config/auth`)),
  patch: (ref: string, body: Record<string, unknown>) =>
    unwrap<AuthConfigResponse>(client.patch(`/projects/${ref}/config/auth`, body)),
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

// ─── connect-cli (Supabase CLI compatibility helpers) ──────────────────────
export const cliApi = {
  /** Returns the deployment's selfbase.toml profile snippet as text/plain. */
  profileToml: () =>
    client
      .get<string>('/cli/profile.toml', { responseType: 'text', transformResponse: (v) => v })
      .then((r) => r.data),
  /**
   * Mints a fresh PAT. The plaintext token is returned ONCE — display it,
   * stash it, do not round-trip.
   */
  mintToken: (label?: string) =>
    unwrap<{ token: string; label: string; prefix: string; id: string }>(
      client.post('/cli/mint-token', { label }),
    ),
};

// ─── wildcard cert (DNS-01) ──────────────────────────────────────────────────
export interface ChallengeRecord {
  name: string;
  value: string;
}
export interface DnsCheck {
  name: string;
  value: string;
  found: boolean;
}
export interface WildcardCertStatus {
  cert: {
    apex: string;
    status: 'pending' | 'awaiting_dns' | 'verifying' | 'issued' | 'failed' | 'disabled';
    challengeRecords: ChallengeRecord[];
    dnsChecks?: DnsCheck[];
    allDnsReady?: boolean;
    notBefore: string | null;
    notAfter: string | null;
    renewalDue: boolean;
    issuedAt: string | null;
    lastError: string | null;
    renewalHistory: {
      triggeredBy: 'initial' | 'manual';
      outcome: 'success' | 'failure' | 'in_progress';
      errorMessage: string | null;
      certNotAfter: string | null;
      startedAt: string;
      finishedAt: string | null;
    }[];
  } | null;
}
export interface WildcardCertInitiate {
  apex: string;
  status: 'awaiting_dns';
  challengeRecords: ChallengeRecord[];
  ttlHint: number;
}
export interface WildcardCertVerify {
  status: 'awaiting_dns' | 'issued' | 'failed';
  dnsChecks?: DnsCheck[];
  allDnsReady?: boolean;
  notBefore?: string;
  notAfter?: string;
  message?: string;
}

export const wildcardCertApi = {
  initiate: () => unwrap<WildcardCertInitiate>(client.post('/wildcard-certs/initiate')),
  verify: () => unwrap<WildcardCertVerify>(client.post('/wildcard-certs/verify')),
  status: () => unwrap<WildcardCertStatus>(client.get('/wildcard-certs/status')),
  disable: () => client.delete('/wildcard-certs'),
};

// ─── Pooler health (feature 008) ────────────────────────────────────────────

export interface PoolerStatusProject {
  ref: string;
  name: string;
  instance_status: string;
  tenant_status: string | null;
  last_error: string | null;
  last_reconciled_at: string | null;
  registered_at: string | null;
  supavisor_present: boolean | null;
}

export interface PoolerStatusEvent {
  id: string;
  ref: string;
  event: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface PoolerStatusRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'partial_failure' | 'failed';
  instances_seen: number;
  actions_taken: Record<string, number>;
  trigger_source: 'cron' | 'manual';
}

export interface PoolerStatusResponse {
  supavisor: { reachable: boolean; healthcheck_status: number | null };
  endpoint: string | null;
  projects: PoolerStatusProject[];
  recent_events: PoolerStatusEvent[];
  recent_runs: PoolerStatusRun[];
}

export interface ReregisterResponse {
  ref: string;
  tenant_status: string | null;
  last_error: string | null;
  reconciler_run_id: string;
  completed_within_window: boolean;
}

export interface ResetPgPasswordResponse {
  ref: string;
  reset_at: string;
  message: string;
  pooler_tenant_status: string | null;
  reconciler_run_id?: string;
}

// ─── feature 010 — secrets management ───────────────────────────────────────
export interface SecretListEntry {
  name: string;
  value: string; // sha256 hex digest of the plaintext (never plaintext)
}

export const secretsApi = {
  list: (ref: string) => unwrap<SecretListEntry[]>(client.get(`/projects/${ref}/secrets`)),
  upsert: (ref: string, secrets: Array<{ name: string; value: string }>) =>
    unwrap<{ message: string }>(client.post(`/projects/${ref}/secrets`, secrets)),
  delete: (ref: string, names: string[]) =>
    unwrap<{ message: string }>(client.delete(`/projects/${ref}/secrets`, { data: names })),
};

export const vaultApi = {
  enable: (ref: string) =>
    unwrap<{ jobId: string; queued: boolean; ref: string }>(
      client.post(`/projects/${ref}/vault/enable`),
    ),
};

// ─── feature 011 — CLI device-code login ────────────────────────────────────
export const cliLoginApi = {
  mint: (body: { session_id: string; token_name: string; public_key: string }) =>
    unwrap<{ device_code: string }>(client.post('/cli/login', body)),
};

export const poolerApi = {
  status: () => unwrap<PoolerStatusResponse>(client.get('/pooler/status')),
  reregister: (ref: string) =>
    unwrap<ReregisterResponse>(client.post(`/pooler/tenants/${ref}/re-register`)),
  runReconciler: () =>
    unwrap<{ run_id: string; status: string; started_at: string; message: string }>(
      client.post('/pooler/reconciler/run'),
    ),
  resetPgPassword: (ref: string) =>
    unwrap<ResetPgPasswordResponse>(client.post(`/instances/${ref}/reset-pg-password`)),
};

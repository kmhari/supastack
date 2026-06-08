import axios, { type AxiosInstance } from 'axios';

// CRITICAL: VITE_API_URL defaults to '' so axios uses relative /api paths.
// Never bake "http://localhost:3001" into the client bundle.
//
// In dev: Vite proxies /api to the backend.
// In prod: Caddy proxies /api/* to the api container.
//
// The legacy supastack studio is now setup-only (feature 086); it keeps the
// `/api/v1` base. Feature 086 changes only the platform studio's API base, not
// this SPA's.
const BASE: string =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? '';

const client: AxiosInstance = axios.create({
  baseURL: `${BASE}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // session cookies
});

const unwrap = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);

// ─── setup ───────────────────────────────────────────────────────────────────
export const setupApi = {
  status: () => unwrap<{ open: boolean }>(client.get('/setup/status')),
  run: (body: { email: string; password: string; orgName: string; apexDomain?: string }) =>
    unwrap<{ userId: string; orgId: string; apiToken: string }>(client.post('/setup', body)),
};

// ─── auth ────────────────────────────────────────────────────────────────────
// Feature 084 — login/logout moved to GoTrue (/auth/v1/{token,logout}); these
// two helpers are retained only because `auth-context` still references them.
// `me` resolves via the api and is used by the setup wizard's auth gate.
export const authApi = {
  login: (body: { email: string; password: string }) => unwrap(client.post('/auth/login', body)),
  logout: () => unwrap(client.post('/auth/logout')),
  me: () =>
    unwrap<{ userId: string; email: string; role: 'admin' | 'member' }>(client.get('/auth/me')),
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
  httpsReachable: boolean;
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

// ─── org (apex domain write, setup wizard step 2) ───────────────────────────
export const orgApi = {
  patch: (body: { name?: string; apexDomain?: string }) => unwrap(client.patch('/org', body)),
};

// ─── wildcard cert (DNS-01, setup wizard step 2) ─────────────────────────────
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
};

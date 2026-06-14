import { client, unwrap } from './api';

/**
 * Typed client for the read-only admin console endpoints (/api/v1/admin/*).
 * Every call is server-authorized (installation admin); the client is UX only.
 * Feature 116 (US2–US5).
 */

// US2 — fleet / health / system / logs
export interface FleetProject {
  ref: string;
  name: string;
  org: string;
  status: string;
  createdAt: string;
  endpoints: { api: string };
}
export interface ProjectDetail {
  ref: string;
  status: string;
  services: { name: string; healthy: boolean; version?: string }[];
  database: { status: string };
}
export interface SystemComponent {
  container: string;
  health: string | null;
  status: string | null;
  image: string | null;
}
export interface SystemStatus {
  deployedCommit: string | null;
  capturedAt: string | null;
  components: SystemComponent[];
}
export interface LogsResult {
  source: string;
  capturedAt: string | null;
  fresh: boolean;
  lines: string[];
}

// US3 — resources
export interface ResourceHost {
  cpuPct: number | null;
  memUsedBytes: number | null;
  memLimitBytes: number | null;
  disk: { projectData: number; backups: number; other: number; free: number } | null;
}
export interface ResourceProject {
  ref: string;
  cpuPct: number | null;
  memUsedBytes: number | null;
  diskUsedBytes: number | null;
}
export interface ResourcesResult {
  capturedAt: string | null;
  collecting?: boolean;
  host?: ResourceHost;
  projects?: ResourceProject[];
  avgProjectFootprint?: { memUsedBytes: number; diskUsedBytes: number };
}
export interface TrendPoint {
  t: string;
  cpuPct: number | null;
  memUsedBytes: number | null;
  diskUsedBytes: number | null;
}

// US4 — queues
export interface QueueCounts {
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  completed: number;
}
export interface FailedJob {
  id: string;
  name: string;
  failedReason: string;
  failedAt: string | null;
  attemptsMade: number;
}
export interface QueueHealth {
  name: string;
  counts: QueueCounts;
  recentFailures: FailedJob[];
}

// US5 — certs / dns / backups
export interface CertsResult {
  wildcard: {
    apex: string;
    notAfter: string | null;
    daysLeft: number | null;
    renewalWarning: boolean;
  } | null;
  perProject: { ref: string; notAfter: string | null; daysLeft: number | null; status: string }[];
  dns: { apexReady: boolean; wildcardReady: boolean };
  backups: {
    totalStorageBytes: number | null;
    perProject: {
      ref: string;
      lastBackupAt: string | null;
      sizeBytes: number | null;
      outcome: string;
    }[];
  };
}

export const adminApi = {
  fleet: () => unwrap<{ projects: FleetProject[] }>(client.get('/admin/fleet')),
  project: (ref: string) => unwrap<ProjectDetail>(client.get(`/admin/projects/${ref}`)),
  system: () => unwrap<SystemStatus>(client.get('/admin/system')),
  logs: (source: string, tail = 200) =>
    unwrap<LogsResult>(client.get('/admin/logs', { params: { source, tail } })),
  resources: () => unwrap<ResourcesResult>(client.get('/admin/resources')),
  resourceTrend: (ref: string, window = '24h') =>
    unwrap<{ ref: string; samples: TrendPoint[] }>(
      client.get(`/admin/resources/${ref}/trend`, { params: { window } }),
    ),
  queues: () => unwrap<{ queues: QueueHealth[] }>(client.get('/admin/queues')),
  certs: () => unwrap<CertsResult>(client.get('/admin/certs')),
};

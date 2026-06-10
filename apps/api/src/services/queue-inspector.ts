/**
 * Read-only BullMQ inspection for the admin Queues view (feature 116 US4).
 * Reads counts + recent failed jobs per queue and redacts secret-bearing failure
 * reasons. Never returns job payloads (FR-022).
 *
 * The queue objects are built explicitly via `new Queue(QUEUES.<key>)` (not a
 * dynamic variable) to satisfy the queue-name contract guard (feature 086) —
 * every BullMQ name must come straight from the shared QUEUES constant.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES, redactSensitive } from '@supastack/shared';

const REDIS_URL = process.env.REDIS_URL!;

let _conn: Redis | null = null;
function conn(): Redis {
  if (!_conn) _conn = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  return _conn;
}

let _registry: Map<string, Queue> | null = null;
function registry(): Map<string, Queue> {
  if (_registry) return _registry;
  const o = { connection: conn() };
  _registry = new Map<string, Queue>([
    [QUEUES.provision, new Queue(QUEUES.provision, o)],
    [QUEUES.lifecycle, new Queue(QUEUES.lifecycle, o)],
    [QUEUES.backup, new Queue(QUEUES.backup, o)],
    [QUEUES.backupScheduler, new Queue(QUEUES.backupScheduler, o)],
    [QUEUES.caddyReload, new Queue(QUEUES.caddyReload, o)],
    [QUEUES.healthReconciler, new Queue(QUEUES.healthReconciler, o)],
    [QUEUES.pgEdgeCertIssue, new Queue(QUEUES.pgEdgeCertIssue, o)],
    [QUEUES.poolerReconciler, new Queue(QUEUES.poolerReconciler, o)],
    [QUEUES.vaultEnable, new Queue(QUEUES.vaultEnable, o)],
    [QUEUES.cleanupOauthCodes, new Queue(QUEUES.cleanupOauthCodes, o)],
    [QUEUES.cleanupOauthRefresh, new Queue(QUEUES.cleanupOauthRefresh, o)],
    [QUEUES.restore, new Queue(QUEUES.restore, o)],
    [QUEUES.restoreGc, new Queue(QUEUES.restoreGc, o)],
    [QUEUES.certCheck, new Queue(QUEUES.certCheck, o)],
    [QUEUES.observer, new Queue(QUEUES.observer, o)],
  ]);
  return _registry;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  completed: number;
}
export interface FailedJobInfo {
  id: string;
  name: string;
  failedReason: string;
  failedAt: string | null;
  attemptsMade: number;
}
export interface QueueHealth {
  name: string;
  counts: QueueCounts;
  recentFailures: FailedJobInfo[];
}

export async function inspectQueues(maxFailed = 10): Promise<QueueHealth[]> {
  const reg = registry();
  const out: QueueHealth[] = [];
  for (const [key, name] of Object.entries(QUEUES)) {
    const q = reg.get(name);
    if (!q) continue;
    const c = await q.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
    const failed = await q.getFailed(0, Math.max(0, maxFailed - 1));
    out.push({
      name: key,
      counts: {
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        failed: c.failed ?? 0,
        delayed: c.delayed ?? 0,
        completed: c.completed ?? 0,
      },
      recentFailures: failed.map((j) => ({
        id: String(j.id ?? ''),
        name: j.name,
        failedReason: redactSensitive(j.failedReason ?? ''),
        failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        attemptsMade: j.attemptsMade ?? 0,
        // NOTE: j.data (payload) is deliberately NOT included (FR-022).
      })),
    });
  }
  return out;
}

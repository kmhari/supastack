/**
 * Canonical BullMQ queue names — the SINGLE source of truth shared by every
 * producer (apps/api enqueues) and every consumer (apps/worker Workers).
 *
 * Why this exists: a producer that enqueues to a name no Worker consumes drops
 * the job silently. Feature 086 found the api enqueuing `selfbase.restore` while
 * the worker consumed `supastack.restore` (the `selfbase.*`→`supastack.*` rename
 * missed the api side), so restores — and lifecycle/backup/pg-edge-cert/pooler/
 * vault enqueues — never ran. Duplicated string literals are how that drift
 * happened. Both sides MUST reference `QUEUES.<key>`; a guard test
 * (apps/api/tests/contract/queue-name-contract.test.ts) fails CI on any bare
 * `new Queue('literal')` / `new Worker('literal')` in apps/api or apps/worker.
 */
export const QUEUES = {
  provision: 'supastack.provision',
  lifecycle: 'supastack.lifecycle',
  backup: 'supastack.backup',
  backupScheduler: 'supastack.backup-scheduler',
  caddyReload: 'supastack.caddy-reload',
  healthReconciler: 'supastack.health-reconciler',
  pgEdgeCertIssue: 'supastack.pg-edge-cert-issue',
  poolerReconciler: 'supastack.pooler-reconciler',
  vaultEnable: 'supastack.vault-enable',
  cleanupOauthCodes: 'supastack.cleanup-oauth-codes',
  cleanupOauthRefresh: 'supastack.cleanup-oauth-refresh',
  restore: 'supastack.restore',
  restoreGc: 'supastack.restore-gc',
  certCheck: 'cert-check',
  // feature 116 — admin ops console resource/health/log sampler (worker-only)
  observer: 'supastack.observer',
} as const;

export type QueueKey = keyof typeof QUEUES;
export type QueueName = (typeof QUEUES)[QueueKey];

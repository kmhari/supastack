import { logger } from '@supastack/shared';
import { loadMasterKey } from '@supastack/crypto';
import { makeDb } from '@supastack/db';
import { connectQueues, startWorkers, stopWorkers } from './queues.js';
import { runMigrateAuthEnvFile } from './jobs/migrate-auth-env-file.js';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? '';

function preflight(): void {
  if (!DATABASE_URL) throw new Error('DATABASE_URL env is missing');
  if (!REDIS_URL) throw new Error('REDIS_URL env is missing');
  loadMasterKey(); // throws if missing/invalid — anti-silent-fallback
}

async function main(): Promise<void> {
  preflight();
  makeDb(DATABASE_URL);
  // Worker also needs schema migrated — but the API does this on its boot.
  // If the worker starts first, that's fine: migrate() is idempotent.
  const { migrate } = await import('@supastack/db');
  await migrate(DATABASE_URL);

  const queues = connectQueues();
  const workers = startWorkers();

  // Repeatable jobs are added once at boot. BullMQ deduplicates them.
  await queues.caddyReload.add(
    'tick',
    {},
    { repeat: { every: 60_000 } /* 60 s safety reconcile */, removeOnComplete: 1 },
  );
  // Hourly backup-scheduler tick — checks each instance's last successful
  // backup and enqueues a new one when overdue (>24h).
  await queues.backupScheduler.add(
    'tick',
    {},
    { repeat: { every: 60 * 60 * 1000 } /* 1 hour */, removeOnComplete: 1 },
  );
  // 30-second health reconciler (T110). Polls actual container state for
  // every non-deleted instance and updates the DB if it diverged.
  await queues.healthReconciler.add('tick', {}, { repeat: { every: 30_000 }, removeOnComplete: 1 });
  // Feature 008 US1 — daily pooler reconciler at 03:00 UTC. The cron tick
  // job has no payload; mode='full' is implied. Manual single-instance
  // passes are enqueued by the api via the same queue with explicit payload.
  await queues.poolerReconciler.add(
    'cron',
    { mode: 'full', triggerSource: 'cron' },
    { repeat: { pattern: '0 3 * * *', tz: 'UTC' }, removeOnComplete: 1 },
  );
  // Feature 014 FR-024a — OAuth code+refresh cleanup crons. Codes expire in
  // 60s so prune at the same cadence; refresh tokens have 30-day idle, hourly
  // sweep is plenty.
  await queues.cleanupOauthCodes.add(
    'tick',
    {},
    { repeat: { every: 60_000 }, removeOnComplete: 1 },
  );
  await queues.cleanupOauthRefresh.add(
    'tick',
    {},
    { repeat: { pattern: '0 * * * *', tz: 'UTC' }, removeOnComplete: 1 },
  );

  logger.info({ queues: Object.keys(queues) }, 'worker started');

  // Feature 024 (#77) — one-shot: re-up auth for all running instances to
  // pick up the new env_file: .env directive in the compose template.
  runMigrateAuthEnvFile().catch((err) =>
    logger.error({ err }, 'migrate-auth-env-file: boot migration failed'),
  );

  const shutdown = async (sig: string): Promise<void> => {
    logger.info({ sig }, 'worker stopping');
    await stopWorkers(workers);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('worker startup failed:', err);
    process.exit(1);
  });
}

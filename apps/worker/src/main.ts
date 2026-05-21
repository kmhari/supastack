import { logger } from '@selfbase/shared';
import { loadMasterKey } from '@selfbase/crypto';
import { makeDb } from '@selfbase/db';
import { connectQueues, startWorkers, stopWorkers } from './queues.js';

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

  const queues = connectQueues();
  const workers = startWorkers();

  // Repeatable jobs are added once at boot. BullMQ deduplicates them.
  await queues.caddyReload.add(
    'tick',
    {},
    { repeat: { every: 60_000 } /* 60 s safety reconcile */, removeOnComplete: 1 },
  );

  logger.info({ queues: Object.keys(queues) }, 'worker started');

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
    // eslint-disable-next-line no-console
    console.error('worker startup failed:', err);
    process.exit(1);
  });
}

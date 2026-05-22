/**
 * One-shot script: re-sync the per-instance `main/index.ts` router across the
 * fleet so existing instances pick up selfbase's eszip-aware variant (v2).
 *
 * Rollout sequence:
 *   1. Deploy api with the new supabase-template (this commit lands T041).
 *   2. Run `pnpm sync:functions-main` against each host (or via cron).
 *   3. Eszip deploys (`POST /v1/projects/:ref/functions` with raw eszip body)
 *      become functional across every instance.
 *
 * Idempotency: each main/index.ts file is fingerprinted by the first-line
 * marker `// selfbase-functions-main:v2` (T041). Instances already on v2 are
 * skipped; legacy/v1 instances get the new router written atomically.
 *
 * The script does NOT restart per-instance functions containers — they pick
 * up the new router on the next deploy. (Restarting all of them would mean
 * a brief global outage on the data plane; we accept eventual consistency.)
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@selfbase/shared';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';
const TEMPLATE_PATH =
  process.env.SELFBASE_FUNCTIONS_TEMPLATE ??
  '/app/infra/supabase-template/volumes/functions/main/index.ts';
const VERSION_MARKER = '// selfbase-functions-main:v2';

interface SyncResult {
  ref: string;
  status: 'updated' | 'already-v2' | 'no-main' | 'error';
  error?: string;
}

async function readTemplate(): Promise<string> {
  try {
    return await readFile(TEMPLATE_PATH, 'utf8');
  } catch (e) {
    throw new Error(
      `Could not read template at ${TEMPLATE_PATH}: ${(e as Error).message}. ` +
        `Set SELFBASE_FUNCTIONS_TEMPLATE if running outside the worker container.`,
    );
  }
}

async function listInstanceRefs(): Promise<string[]> {
  try {
    const ents = await readdir(INSTANCES_DIR, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

async function syncOne(ref: string, template: string): Promise<SyncResult> {
  const mainPath = path.join(INSTANCES_DIR, ref, 'volumes', 'functions', 'main', 'index.ts');
  try {
    await stat(mainPath);
  } catch {
    return { ref, status: 'no-main' };
  }
  try {
    const current = await readFile(mainPath, 'utf8');
    if (current.startsWith(VERSION_MARKER)) {
      return { ref, status: 'already-v2' };
    }
    // Write to a sibling tempfile and rename, so a crashed write doesn't leave
    // a half-rewritten router on disk.
    const tmp = `${mainPath}.tmp-${process.pid}`;
    await writeFile(tmp, template);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, mainPath);
    return { ref, status: 'updated' };
  } catch (e) {
    return { ref, status: 'error', error: (e as Error).message };
  }
}

async function main(): Promise<void> {
  const template = await readTemplate();
  if (!template.startsWith(VERSION_MARKER)) {
    throw new Error(
      `Template at ${TEMPLATE_PATH} is missing the '${VERSION_MARKER}' marker on its first line. ` +
        `T041 must land before this script can run safely.`,
    );
  }
  const refs = await listInstanceRefs();
  logger.info({ count: refs.length }, 'sync-functions-main: scanning instances');

  const results: SyncResult[] = [];
  for (const ref of refs) {
    results.push(await syncOne(ref, template));
  }

  const tally = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  logger.info({ tally }, 'sync-functions-main: done');

  const errors = results.filter((r) => r.status === 'error');
  if (errors.length > 0) {
    for (const e of errors) logger.error({ ref: e.ref, error: e.error });
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error({ err }, 'sync-functions-main: fatal');
  process.exit(1);
});

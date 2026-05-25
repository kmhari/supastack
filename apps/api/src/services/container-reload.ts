/**
 * Container reload helper with .env rollback on failure.
 *
 * Extracted from secret-store.ts so feature 009 (runtime-config-tunables)
 * can reuse it for the PostgREST + GoTrue containers without duplicating
 * the rollback logic.
 *
 * Spec: specs/009-runtime-config-tunables/research.md R-003, R-007.
 */
import { writeFile, rename } from 'node:fs/promises';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import { getDockerControl } from './docker-control-adapter.js';

async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, target);
}

/**
 * Restart `containerName`. On failure, atomically restore `envPath` to
 * `envBackup` and throw a `ManagementApiError(500, 'restart_failed')`.
 *
 * Caller is responsible for having written the new `.env` *before* calling
 * this — rollback only undoes that one write.
 */
export async function restartOrRollback(
  containerName: string,
  envPath: string,
  envBackup: string,
): Promise<void> {
  const docker = getDockerControl();
  try {
    await docker.restart(containerName);
    await docker.waitHealthy(containerName, 5000);
  } catch (err) {
    await atomicWrite(envPath, envBackup).catch(() => {});
    throw new ManagementApiError(
      500,
      `Container ${containerName} failed to restart with the new env; the previous environment has been restored.`,
      'restart_failed',
      { container: containerName, cause: (err as Error).message },
    );
  }
}

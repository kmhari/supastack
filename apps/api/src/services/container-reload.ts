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
import { composeUpService } from '@selfbase/docker-control';
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
    // GoTrue + other per-instance containers take 10-30s to bind + pass
    // healthcheck on a healthy VM. Match the dashboard's pollUntilHealthy
    // budget (60s; specs/020-auth-providers-dashboard SC-007).
    await docker.waitHealthy(containerName, 60_000);
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

/**
 * Recreate a single per-instance service so the new `.env` flows through
 * compose variable substitution to the container env. A plain
 * `docker restart` does NOT reload env_file / variable substitution — only
 * `docker compose up -d <service>` does. Used by feature 020's auth-config
 * PATCH so changes flow end-to-end.
 *
 * On failure (compose error OR container fails to become healthy), atomically
 * restores `envBackup` and throws `restart_failed`.
 *
 * `composeDir` is the per-instance directory containing `docker-compose.yml`
 * and the `.env` file we just rewrote.
 */
export async function recreateOrRollback(
  composeDir: string,
  projectName: string,
  serviceName: string,
  containerName: string,
  envPath: string,
  envBackup: string,
): Promise<void> {
  const docker = getDockerControl();
  try {
    await composeUpService({ dir: composeDir, projectName }, serviceName);
    await docker.waitHealthy(containerName, 60_000);
  } catch (err) {
    await atomicWrite(envPath, envBackup).catch(() => {});
    // Attempt to also re-substitute the recovered env into the container.
    // Best-effort: if this fails, the .env file is at least correct.
    await composeUpService({ dir: composeDir, projectName }, serviceName).catch(() => {});
    throw new ManagementApiError(
      500,
      `Container ${containerName} failed to recreate with the new env; the previous environment has been restored.`,
      'restart_failed',
      { container: containerName, cause: (err as Error).message },
    );
  }
}

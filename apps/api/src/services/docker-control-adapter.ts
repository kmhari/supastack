/**
 * Thin adapter over the docker socket for the container-level operations
 * function-deploy and secret-store need:
 *   - restart(name)          — `docker restart <container>`
 *   - waitHealthy(name, ms)  — poll until status=running AND health=healthy
 *
 * In tests, a fake control object is injected via the global hook
 * `globalThis.__selfbaseFakeDockerControl`; the production path delegates
 * to dockerode against /var/run/docker.sock.
 */
import { restartContainer, waitContainerHealthy } from '@selfbase/docker-control';

export interface DockerControl {
  restart(container: string): Promise<void>;
  waitHealthy(container: string, timeoutMs?: number): Promise<void>;
}

const realControl: DockerControl = {
  restart: (name) => restartContainer(name),
  waitHealthy: (name, timeoutMs) => waitContainerHealthy(name, timeoutMs),
};

export function getDockerControl(): DockerControl {
  const fake = (globalThis as { __selfbaseFakeDockerControl?: DockerControl })
    .__selfbaseFakeDockerControl;
  return fake ?? realControl;
}

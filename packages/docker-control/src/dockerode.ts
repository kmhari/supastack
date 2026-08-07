import { spawn } from 'node:child_process';
import path from 'node:path';
import Docker from 'dockerode';

const docker = new Docker(); // uses /var/run/docker.sock by default

/**
 * The one stack definition a per-instance invocation may load.
 *
 * Compose reads `COMPOSE_FILE` out of the project's `.env` *before* it loads
 * any stack, so an env file that assigns it selects which YAML runs — and the
 * `config -q` round-trip then happily validates the attacker's stack instead of
 * ours (feature 121, research.md Q1). Passing `-f` explicitly makes that inert:
 * measured on Compose v5.0.2, the same injected `.env` resolves the intended
 * service with the flag and the attacker's without it.
 *
 * This is defence that does not depend on having enumerated every input.
 */
export const INSTANCE_COMPOSE_FILE = 'docker-compose.yml';

/**
 * Thin wrappers over `docker compose` for the per-instance lifecycle.
 * We shell out to docker compose for stack ops (no good library equivalent),
 * and use dockerode for inspection (status, exec, logs).
 *
 * All operations are scoped to a single Compose project name —
 * `selfbase-<ref>` per the provisioning convention.
 */

export interface ComposeContext {
  /** Compose project name, e.g. `selfbase-<ref>` */
  projectName: string;
  /** Absolute path to the directory containing docker-compose.yml + .env */
  dir: string;
}

export interface ContainerSnapshot {
  name: string;
  service: string;
  state: string;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
}

export async function composeUp(ctx: ComposeContext): Promise<void> {
  await runDockerCompose(ctx, ['up', '-d']);
}
export async function composeStop(ctx: ComposeContext): Promise<void> {
  await runDockerCompose(ctx, ['stop']);
}
export async function composeStart(ctx: ComposeContext): Promise<void> {
  await runDockerCompose(ctx, ['start']);
}
export async function composeRestart(ctx: ComposeContext): Promise<void> {
  await runDockerCompose(ctx, ['restart']);
}
export async function composeRestartService(ctx: ComposeContext, service: string): Promise<void> {
  await runDockerCompose(ctx, ['restart', service]);
}

/**
 * Re-create a single service in the compose project. Unlike `docker restart`
 * (which keeps the container's existing env), this re-reads the per-instance
 * .env file and recreates the container with the new substituted values.
 *
 * Used by feature 020's auth-config PATCH path so changes flow through to
 * GoTrue without recreating the entire per-instance stack.
 */
export async function composeUpService(ctx: ComposeContext, service: string): Promise<void> {
  await runDockerCompose(ctx, ['up', '-d', '--no-deps', service]);
}

/**
 * Restart a single container by name. Used by the function-deploy and
 * secret-set hot paths to bounce only the per-instance `functions` container
 * — avoids pulling Postgres + Kong + Realtime down on every code change.
 */
export async function restartContainer(
  name: string,
  opts: { timeoutSec?: number } = {},
): Promise<void> {
  await docker.getContainer(name).restart({ t: opts.timeoutSec ?? 5 });
}

/**
 * Block until the named container is `Running` AND (`Health=healthy` OR no
 * healthcheck defined). Polls every 250ms; throws on `timeoutMs` (default 5s).
 *
 * The per-instance functions container's healthcheck (or lack thereof,
 * depending on supabase-template version) determines which arm of the
 * condition wins. Either is acceptable for "ready to accept requests".
 */
export async function waitContainerHealthy(name: string, timeoutMs: number = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await docker.getContainer(name).inspect();
      const running = info.State?.Running === true;
      const health = info.State?.Health?.Status;
      if (running && (health === 'healthy' || health === undefined)) return;
    } catch {
      /* container may be briefly missing during restart — keep polling */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`container ${name} did not become healthy within ${timeoutMs}ms`);
}
export async function composeDown(
  ctx: ComposeContext,
  opts: { removeVolumes?: boolean } = {},
): Promise<void> {
  const args = ['down'];
  if (opts.removeVolumes) args.push('-v');
  await runDockerCompose(ctx, args);
}
export async function composePull(ctx: ComposeContext): Promise<void> {
  await runDockerCompose(ctx, ['pull']);
}

export async function composePs(ctx: ComposeContext): Promise<ContainerSnapshot[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${ctx.projectName}`] },
  });

  return containers.map((c) => {
    const name = (c.Names[0] ?? '').replace(/^\//, '');
    const service =
      c.Labels['com.docker.compose.service'] ??
      name.replace(new RegExp(`^${ctx.projectName}-`), '');
    let health: ContainerSnapshot['health'] = 'none';
    if (c.Status.includes('(healthy)')) health = 'healthy';
    else if (c.Status.includes('(unhealthy)')) health = 'unhealthy';
    else if (c.Status.includes('(health: starting)')) health = 'starting';
    return { name, service, state: c.State, health };
  });
}

/** Returns true once every container in the compose project is `running` AND
 * (`healthy` OR `none` if no healthcheck). 3-min cap recommended at caller. */
export async function composeAllHealthy(ctx: ComposeContext): Promise<boolean> {
  const snapshots = await composePs(ctx);
  if (snapshots.length === 0) return false;
  return snapshots.every(
    (s) => s.state === 'running' && (s.health === 'healthy' || s.health === 'none'),
  );
}

export async function composeExec(
  ctx: ComposeContext,
  service: string,
  cmd: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const args = composeArgs(ctx, ['exec', '-T', service, ...cmd]);
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
  });
}

/** Returns a Node Readable that streams `docker compose exec -T <svc> <cmd>` stdout. */
export function composeExecStream(
  ctx: ComposeContext,
  service: string,
  cmd: string[],
): NodeJS.ReadableStream {
  const args = composeArgs(ctx, ['exec', '-T', service, ...cmd]);
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  return child.stdout;
}

/**
 * The single place per-instance `docker compose` argv is built. Every
 * invocation names its project, its project directory AND its stack file, so
 * none of the three can be steered by the contents of the project's `.env`
 * (FR-007 / C8).
 *
 * Keep it that way: a new compose call must go through here. A contract test
 * fails if a second construction site appears.
 */
function composeArgs(ctx: ComposeContext, args: string[]): string[] {
  return [
    'compose',
    '-p',
    ctx.projectName,
    '--project-directory',
    ctx.dir,
    '-f',
    path.join(ctx.dir, INSTANCE_COMPOSE_FILE),
    ...args,
  ];
}

async function runDockerCompose(ctx: ComposeContext, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', composeArgs(ctx, args), {
      cwd: ctx.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('error', (err) =>
      reject(new Error(`docker compose ${args.join(' ')}: ${err.message}`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`docker compose ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`),
        );
    });
  });
}

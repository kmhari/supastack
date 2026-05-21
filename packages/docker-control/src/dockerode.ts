import { spawn } from 'node:child_process';
import Docker from 'dockerode';

const docker = new Docker(); // uses /var/run/docker.sock by default

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
    const args = ['compose', '-p', ctx.projectName, '--project-directory', ctx.dir, 'exec', '-T', service, ...cmd];
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
  const args = [
    'compose',
    '-p',
    ctx.projectName,
    '--project-directory',
    ctx.dir,
    'exec',
    '-T',
    service,
    ...cmd,
  ];
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  return child.stdout;
}

async function runDockerCompose(ctx: ComposeContext, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['compose', '-p', ctx.projectName, ...args], {
      cwd: ctx.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('error', (err) => reject(new Error(`docker compose ${args.join(' ')}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`));
    });
  });
}

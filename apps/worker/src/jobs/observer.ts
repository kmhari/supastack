/**
 * Feature 116 — admin ops console "observer" sampler. Runs in the worker (the
 * only container with the docker socket + host mounts; Constitution V). Each
 * tick samples per-project + host resource usage, control-plane container health,
 * and recent (redacted) control-plane log tails into `resource_samples` +
 * `control_plane_snapshots`. The api reads those tables (no docker on the api).
 *
 * Sampling is ONE-SHOT / non-blocking (docker stats stream:false), so it never
 * holds open a streaming connection that could load the running projects (FR-020).
 *
 * The pure aggregation + the runObserver orchestration take injected deps so
 * they are unit-tested with a fake docker/disk; makeRealDeps wires dockerode +
 * fs/exec and is best-effort (not unit-tested).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs } from 'node:fs/promises';
import { db, schema } from '@supastack/db';
import { redactSensitive } from '@supastack/shared';
import { lt } from 'drizzle-orm';

const execFileP = promisify(execFile);

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';
const BACKUPS_DIR = process.env.BACKUPS_DIR ?? '/var/supastack/backups';
const LOG_TAIL = 200;

const CONTROL_PLANE = [
  'supastack-api-1',
  'supastack-worker-1',
  'supastack-redis-1',
  'supastack-db-1',
  'supastack-caddy-1',
  'supastack-supavisor-1',
  'supastack-mcp-1',
  'supastack-web-1',
];

// ─── types ────────────────────────────────────────────────────────────────
export interface ContainerStat {
  name: string;
  cpuPct: number;
  memUsed: number;
  memLimit: number;
}
export interface DiskBreakdown {
  projectData: number;
  backups: number;
  other: number;
  free: number;
  used: number;
}
export interface ControlPlaneStatus {
  container: string;
  health: string | null;
  status: string | null;
  image: string | null;
  logTail: string;
}
export interface ObserverDeps {
  containerStats(): Promise<ContainerStat[]>;
  hostMemTotal(): Promise<number>;
  diskBreakdown(): Promise<DiskBreakdown>;
  controlPlane(): Promise<ControlPlaneStatus[]>;
  now(): Date;
}

// ─── pure aggregation (unit-tested) ─────────────────────────────────────────
export interface ProjectSample {
  ref: string;
  cpuPct: number;
  memUsed: number;
}

const REF_RE = /^supastack-([a-z0-9]{20})-/;

/** Group per-container stats into per-project totals (sum the project's containers). */
export function aggregateProjects(stats: ContainerStat[]): ProjectSample[] {
  const byRef = new Map<string, ProjectSample>();
  for (const s of stats) {
    const m = s.name.replace(/^\//, '').match(REF_RE);
    const ref = m?.[1];
    if (!ref) continue;
    const cur = byRef.get(ref) ?? { ref, cpuPct: 0, memUsed: 0 };
    cur.cpuPct += s.cpuPct;
    cur.memUsed += s.memUsed;
    byRef.set(ref, cur);
  }
  return [...byRef.values()];
}

/** Host CPU/mem ≈ sum across all containers. */
export function hostCpuMem(stats: ContainerStat[]): { cpuPct: number; memUsed: number } {
  return stats.reduce((a, s) => ({ cpuPct: a.cpuPct + s.cpuPct, memUsed: a.memUsed + s.memUsed }), {
    cpuPct: 0,
    memUsed: 0,
  });
}

// ─── orchestration (unit-tested with fake deps) ─────────────────────────────
export async function runObserver(
  deps: ObserverDeps,
  opts: { retentionDays: number },
): Promise<void> {
  const capturedAt = deps.now();
  const [stats, memTotal, disk, cp] = await Promise.all([
    deps.containerStats(),
    deps.hostMemTotal(),
    deps.diskBreakdown(),
    deps.controlPlane(),
  ]);

  const projects = aggregateProjects(stats);
  const host = hostCpuMem(stats);

  const rows = [
    {
      capturedAt,
      scope: 'host',
      ref: null,
      cpuPct: String(round2(host.cpuPct)),
      memUsedBytes: host.memUsed,
      memLimitBytes: memTotal,
      diskUsedBytes: disk.used,
      diskBreakdown: disk,
    },
    ...projects.map((p) => ({
      capturedAt,
      scope: 'project',
      ref: p.ref,
      cpuPct: String(round2(p.cpuPct)),
      memUsedBytes: p.memUsed,
      memLimitBytes: null,
      diskUsedBytes: null,
      diskBreakdown: null,
    })),
  ];
  if (rows.length > 0) {
    await db().insert(schema.resourceSamples).values(rows);
  }

  for (const c of cp) {
    const redacted = redactSensitive(c.logTail);
    const fields = {
      capturedAt,
      health: c.health,
      status: c.status,
      image: c.image,
      logTail: redacted,
    };
    await db()
      .insert(schema.controlPlaneSnapshots)
      .values({ container: c.container, ...fields })
      .onConflictDoUpdate({ target: schema.controlPlaneSnapshots.container, set: fields });
  }

  const cutoff = new Date(capturedAt.getTime() - opts.retentionDays * 86_400_000);
  await db().delete(schema.resourceSamples).where(lt(schema.resourceSamples.capturedAt, cutoff));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── real deps (dockerode + fs/exec — best-effort, not unit-tested) ─────────
export function makeRealDeps(): ObserverDeps {
  // Lazy-import dockerode so the module (pure fns + runObserver) loads without it
  // in unit tests, which never call makeRealDeps.
  type DockerLike = {
    listContainers: (o: { all: boolean }) => Promise<{ Id: string; Names?: string[] }[]>;
    getContainer: (id: string) => {
      stats: (o: { stream: boolean }) => Promise<unknown>;
      inspect: () => Promise<unknown>;
      logs: (o: {
        stdout: boolean;
        stderr: boolean;
        tail: number;
        timestamps: boolean;
      }) => Promise<unknown>;
    };
    info: () => Promise<unknown>;
  };
  let cached: DockerLike | null = null;
  const docker = async (): Promise<DockerLike> => {
    if (!cached) {
      const Docker = (await import('dockerode')).default;
      cached = new Docker() as unknown as DockerLike;
    }
    return cached;
  };

  return {
    now: () => new Date(),

    async containerStats() {
      const list = (await (await docker()).listContainers({ all: false })) as {
        Id: string;
        Names?: string[];
      }[];
      const out: ContainerStat[] = [];
      await Promise.all(
        list.map(async (c) => {
          try {
            const s = (await (await docker())
              .getContainer(c.Id)
              .stats({ stream: false })) as Record<string, never>;
            out.push({
              name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
              cpuPct: computeCpu(s),
              memUsed: pick(s, ['memory_stats', 'usage']) ?? 0,
              memLimit: pick(s, ['memory_stats', 'limit']) ?? 0,
            });
          } catch {
            /* skip a container that vanished mid-tick */
          }
        }),
      );
      return out;
    },

    async hostMemTotal() {
      try {
        const info = (await (await docker()).info()) as { MemTotal?: number };
        return info.MemTotal ?? 0;
      } catch {
        return 0;
      }
    },

    async diskBreakdown() {
      const [projectData, backups, fs] = await Promise.all([
        duBytes(INSTANCES_DIR),
        duBytes(BACKUPS_DIR),
        statfs(INSTANCES_DIR).catch(() => null),
      ]);
      const free = fs ? Number(fs.bsize) * Number(fs.bavail) : 0;
      const total = fs ? Number(fs.bsize) * Number(fs.blocks) : 0;
      const used = total > 0 ? total - free : projectData + backups;
      const other = Math.max(0, used - projectData - backups);
      return { projectData, backups, other, free, used };
    },

    async controlPlane() {
      const out: ControlPlaneStatus[] = [];
      await Promise.all(
        CONTROL_PLANE.map(async (name) => {
          try {
            const info = (await (await docker()).getContainer(name).inspect()) as {
              State?: { Health?: { Status?: string }; Status?: string };
              Config?: { Image?: string };
            };
            const buf = (await (await docker()).getContainer(name).logs({
              stdout: true,
              stderr: true,
              tail: LOG_TAIL,
              timestamps: false,
            })) as unknown as Buffer;
            out.push({
              container: name,
              health: info.State?.Health?.Status ?? null,
              status: info.State?.Status ?? null,
              image: info.Config?.Image ?? null,
              logTail: demuxDockerLog(buf),
            });
          } catch {
            /* container not present on this host — skip */
          }
        }),
      );
      return out;
    },
  };
}

function pick(obj: unknown, path: string[]): number | undefined {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'number' ? cur : undefined;
}

function computeCpu(s: Record<string, never>): number {
  const cur = pick(s, ['cpu_stats', 'cpu_usage', 'total_usage']) ?? 0;
  const pre = pick(s, ['precpu_stats', 'cpu_usage', 'total_usage']) ?? 0;
  const sysCur = pick(s, ['cpu_stats', 'system_cpu_usage']) ?? 0;
  const sysPre = pick(s, ['precpu_stats', 'system_cpu_usage']) ?? 0;
  const cpus = pick(s, ['cpu_stats', 'online_cpus']) ?? 1;
  const cpuDelta = cur - pre;
  const sysDelta = sysCur - sysPre;
  if (sysDelta <= 0 || cpuDelta < 0) return 0;
  return round2((cpuDelta / sysDelta) * cpus * 100);
}

/** Strip docker's 8-byte stream-frame headers from a non-TTY log buffer. */
function demuxDockerLog(buf: Buffer): string {
  if (!Buffer.isBuffer(buf)) return String(buf ?? '');
  const lines: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    const start = i + 8;
    const end = start + len;
    if (end > buf.length) break;
    lines.push(buf.toString('utf8', start, end));
    i = end;
  }
  const text = lines.length > 0 ? lines.join('') : buf.toString('utf8');
  return text.trim();
}

async function duBytes(dir: string): Promise<number> {
  try {
    const { stdout } = await execFileP('du', ['-sb', dir]);
    return Number(stdout.split(/\s+/)[0]) || 0;
  } catch {
    return 0;
  }
}

export async function handleObserver(): Promise<void> {
  await runObserver(makeRealDeps(), {
    retentionDays: Number(process.env.OBSERVER_RETENTION_DAYS ?? 7),
  });
}

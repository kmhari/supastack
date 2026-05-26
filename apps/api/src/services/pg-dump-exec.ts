/**
 * pg_dump streaming via Docker socket exec — feature 013 db dump
 * (research.md Decision 4).
 *
 * Shells `pg_dump` inside the per-instance `selfbase-<ref>-db-1` container via
 * the Docker Engine HTTP API at /var/run/docker.sock (same socket already
 * mounted into the api container for pg-password-reset.ts). Streams stdout
 * directly to the caller's WritableStream — no buffering. Honors AbortSignal:
 * on abort, calls Docker exec kill so no zombie pg_dump remains.
 *
 * AttachStdout/AttachStderr return a multiplexed stream (Docker frame format):
 *   header: 8 bytes — [streamType, 0, 0, 0, size_be32]
 *     streamType: 0=stdin, 1=stdout, 2=stderr
 *     size_be32:  payload length in bytes
 *   payload: <size_be32> bytes
 * We demux: stdout → `output`; stderr → in-memory buffer (capped at 8KB) for
 * surfacing in the error message if pg_dump exits non-zero.
 */
import http from 'node:http';
import type { Writable } from 'node:stream';

const DOCKER_SOCK = '/var/run/docker.sock';
const STDERR_BUFFER_CAP = 8 * 1024;
const KILL_SIGNAL = 'SIGKILL';

export class PgDumpFailedError extends Error {
  code = 'pg_dump_failed' as const;
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`pg_dump exited ${exitCode}: ${stderr.slice(0, 400)}`);
  }
}

export class DockerExecFailedError extends Error {
  code = 'docker_exec_failed' as const;
  constructor(message: string) {
    super(message);
  }
}

export interface PgDumpFlags {
  dataOnly?: boolean;
  schemaOnly?: boolean;
  schemas?: string[];
}

export interface PgDumpResult {
  exitCode: number;
  bytesWritten: number;
  aborted: boolean;
}

/**
 * Build the pg_dump argv. Exported for unit testing.
 */
export function buildPgDumpArgs(flags: PgDumpFlags): string[] {
  const args = [
    'pg_dump',
    '-h',
    '127.0.0.1',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--no-owner',
    '--no-privileges',
  ];
  if (flags.dataOnly) args.push('--data-only');
  if (flags.schemaOnly) args.push('--schema-only');
  if (flags.schemas) {
    for (const s of flags.schemas) args.push(`--schema=${s}`);
  }
  return args;
}

/**
 * Stream pg_dump output for a given selfbase project ref. Returns when the
 * exec exits (or after abort signal cleanup completes). Throws
 * DockerExecFailedError on Docker socket errors, PgDumpFailedError when the
 * exec exits non-zero (and we weren't aborted by the caller).
 */
export async function streamPgDump(
  ref: string,
  flags: PgDumpFlags,
  output: Writable,
  signal: AbortSignal,
): Promise<PgDumpResult> {
  const container = `selfbase-${ref}-db-1`;
  const argv = buildPgDumpArgs(flags);

  // 1. Create exec.
  const execId = await dockerCreateExec(container, argv);

  // 2. Start exec + stream demuxed output.
  let bytesWritten = 0;
  let stderrBuf = '';
  let aborted = false;
  const killExec = async (): Promise<void> => {
    try {
      await dockerKillExec(execId, KILL_SIGNAL);
    } catch {
      // Best-effort. The container may already have reaped the process.
    }
  };
  const onAbort = (): void => {
    aborted = true;
    void killExec();
  };
  signal.addEventListener('abort', onAbort);

  try {
    await dockerStartExecStream(execId, output, (chunk) => {
      bytesWritten += chunk;
    }, (stderrChunk) => {
      if (stderrBuf.length < STDERR_BUFFER_CAP) {
        stderrBuf += stderrChunk.toString('utf8');
        if (stderrBuf.length > STDERR_BUFFER_CAP) stderrBuf = stderrBuf.slice(0, STDERR_BUFFER_CAP);
      }
    });
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  // 3. Inspect for exit code.
  const exitCode = await dockerInspectExec(execId);

  if (aborted) {
    return { exitCode, bytesWritten, aborted: true };
  }
  if (exitCode !== 0) {
    throw new PgDumpFailedError(exitCode, stderrBuf);
  }
  return { exitCode, bytesWritten, aborted: false };
}

// ─── Docker socket plumbing ────────────────────────────────────────────────

function dockerCreateExec(container: string, cmd: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: cmd,
    });
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        method: 'POST',
        path: `/containers/${container}/exec`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 201) {
            reject(new DockerExecFailedError(`docker exec create ${res.statusCode}: ${buf}`));
            return;
          }
          try {
            const parsed = JSON.parse(buf) as { Id?: string };
            if (!parsed.Id) {
              reject(new DockerExecFailedError('docker exec create: missing Id'));
              return;
            }
            resolve(parsed.Id);
          } catch (err) {
            reject(new DockerExecFailedError(`docker exec create parse: ${(err as Error).message}`));
          }
        });
      },
    );
    req.on('error', (err) => reject(new DockerExecFailedError(err.message)));
    req.write(body);
    req.end();
  });
}

/**
 * POST /exec/<id>/start with Detach:false, Tty:false. Demuxes the multiplexed
 * frame stream into stdout (→ `output` Writable) and stderr (→ `onStderr`
 * callback). Resolves when the underlying response ends.
 */
function dockerStartExecStream(
  execId: string,
  output: Writable,
  onStdoutChunk: (bytes: number) => void,
  onStderr: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ Detach: false, Tty: false });
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        method: 'POST',
        path: `/exec/${execId}/start`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let pending = Buffer.alloc(0);

        const writeStdout = (chunk: Buffer): void => {
          onStdoutChunk(chunk.length);
          // Honor backpressure by waiting for `drain` if write returns false.
          if (!output.write(chunk)) {
            res.pause();
            output.once('drain', () => res.resume());
          }
        };

        res.on('data', (chunk: Buffer) => {
          pending =
            pending.length === 0
              ? Buffer.from(chunk)
              : Buffer.concat([pending, chunk]);
          // Demux frames: 8-byte header then payload.
          while (pending.length >= 8) {
            const streamType = pending[0]!;
            const size = pending.readUInt32BE(4);
            if (pending.length < 8 + size) break;
            const payload = pending.subarray(8, 8 + size);
            pending = pending.subarray(8 + size);
            if (streamType === 1) {
              writeStdout(payload);
            } else if (streamType === 2) {
              onStderr(payload);
            }
            // streamType 0 (stdin) shouldn't appear in this direction
          }
        });
        res.on('end', () => resolve());
        res.on('error', (err) => reject(new DockerExecFailedError(err.message)));
      },
    );
    req.on('error', (err) => reject(new DockerExecFailedError(err.message)));
    req.write(body);
    req.end();
  });
}

function dockerInspectExec(execId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCK, method: 'GET', path: `/exec/${execId}/json` },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(buf) as { ExitCode?: number; Running?: boolean };
            resolve(parsed.ExitCode ?? -1);
          } catch (err) {
            reject(new DockerExecFailedError(`docker exec inspect parse: ${(err as Error).message}`));
          }
        });
      },
    );
    req.on('error', (err) => reject(new DockerExecFailedError(err.message)));
    req.end();
  });
}

/**
 * Docker doesn't expose a clean "kill exec" — instead, kill the underlying
 * container process. We use exec inspect → pid lookup → host kill via another
 * exec into the container that signals the pg_dump pid by argv match. Simpler
 * + portable: spawn `pkill -<sig> -f '<pattern>'` inside the container.
 *
 * Reuses the same Docker socket. The pattern is uniquely "pg_dump" args we
 * just spawned; we kill all pg_dumps for safety (operator-driven endpoint;
 * concurrent pg_dump invocations from the same ref are not expected).
 */
async function dockerKillExec(execId: string, signal: string): Promise<void> {
  // Get container id from exec metadata.
  const containerId = await dockerInspectExecContainer(execId);
  if (!containerId) return;
  // pkill the pg_dump processes inside the container. `--full` matches argv.
  await dockerExecOneShot(containerId, [
    'pkill',
    `--signal=${signal}`,
    '--full',
    '^pg_dump',
  ]);
}

function dockerInspectExecContainer(execId: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCK, method: 'GET', path: `/exec/${execId}/json` },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(buf) as { ContainerID?: string };
            resolve(parsed.ContainerID ?? null);
          } catch (err) {
            reject(new DockerExecFailedError((err as Error).message));
          }
        });
      },
    );
    req.on('error', (err) => reject(new DockerExecFailedError(err.message)));
    req.end();
  });
}

function dockerExecOneShot(container: string, cmd: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ AttachStdout: false, AttachStderr: false, Tty: false, Cmd: cmd });
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        method: 'POST',
        path: `/containers/${container}/exec`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c.toString()));
        res.on('end', () => {
          if (res.statusCode !== 201) {
            reject(new DockerExecFailedError(`exec create ${res.statusCode}: ${buf}`));
            return;
          }
          try {
            const parsed = JSON.parse(buf) as { Id?: string };
            if (!parsed.Id) {
              reject(new DockerExecFailedError('kill exec create: missing Id'));
              return;
            }
            // Start the kill exec (fire-and-forget).
            const startBody = JSON.stringify({ Detach: true, Tty: false });
            const startReq = http.request(
              {
                socketPath: DOCKER_SOCK,
                method: 'POST',
                path: `/exec/${parsed.Id}/start`,
                headers: {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(startBody),
                },
              },
              (startRes) => {
                startRes.on('data', () => {});
                startRes.on('end', () => resolve());
              },
            );
            startReq.on('error', (err) => reject(new DockerExecFailedError(err.message)));
            startReq.write(startBody);
            startReq.end();
          } catch (err) {
            reject(new DockerExecFailedError((err as Error).message));
          }
        });
      },
    );
    req.on('error', (err) => reject(new DockerExecFailedError(err.message)));
    req.write(body);
    req.end();
  });
}

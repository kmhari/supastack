/**
 * C8 / FR-007 — every per-instance `docker compose` invocation names its stack
 * file explicitly.
 *
 * Asserted as a property of OUR ARGV, never of Compose's behaviour. Whether
 * `-f` wins over a `COMPOSE_FILE` in the env file is a property of the CLI
 * version and would make this suite fail on a Docker upgrade for no reason
 * (plan Risk 3). That behaviour is demonstrated once, against a real binary,
 * in `tests/integration/compose-redirect.test.ts`.
 *
 * Two layers, because either alone rots:
 *  1. behavioural — mock `spawn`, drive every exported entry point, inspect argv
 *  2. structural  — fail if a second argv construction site appears in the
 *     package, since a new one would pass layer 1 by simply not being called
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

const CTX = { projectName: 'supastack-abcdefghij0123456789', dir: '/var/supastack/instances/abc' };
const EXPECTED_FILE = '/var/supastack/instances/abc/docker-compose.yml';

/** A child process that reports clean exit on the next tick. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => child.emit('close', 0));
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => fakeChild());
});

afterEach(() => {
  vi.resetModules();
});

/**
 * Every exported function in dockerode.ts that shells out to compose. Listing
 * them by name rather than deriving them keeps the list reviewable — a new
 * spawn site that nobody added here is caught by the structural guard below.
 */
const INVOCATIONS = [
  'composeUp',
  'composeStop',
  'composeStart',
  'composeRestart',
  'composeRestartService',
  'composeUpService',
  'composeDown',
  'composeDown -v',
  'composePull',
  'composeExec',
  'composeExecStream',
] as const;

async function invoke(name: (typeof INVOCATIONS)[number]): Promise<void> {
  const d = await import('../../src/dockerode.js');
  switch (name) {
    case 'composeUp':
      return d.composeUp(CTX);
    case 'composeStop':
      return d.composeStop(CTX);
    case 'composeStart':
      return d.composeStart(CTX);
    case 'composeRestart':
      return d.composeRestart(CTX);
    case 'composeRestartService':
      return d.composeRestartService(CTX, 'auth');
    case 'composeUpService':
      return d.composeUpService(CTX, 'auth');
    case 'composeDown':
      return d.composeDown(CTX);
    case 'composeDown -v':
      return d.composeDown(CTX, { removeVolumes: true });
    case 'composePull':
      return d.composePull(CTX);
    case 'composeExec':
      await d.composeExec(CTX, 'db', ['psql', '-c', 'select 1']);
      return;
    case 'composeExecStream':
      d.composeExecStream(CTX, 'db', ['cat', '/tmp/x']);
      return;
  }
}

describe('C8 — every compose spawn pins its stack file', () => {
  test.each(INVOCATIONS)('%s passes -f <dir>/docker-compose.yml', async (name) => {
    await invoke(name);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe('docker');
    expect(args[0]).toBe('compose');

    const fileFlag = args.indexOf('-f');
    expect(
      fileFlag,
      'no -f argument — the env file could redirect stack selection',
    ).toBeGreaterThan(-1);
    expect(args[fileFlag + 1]).toBe(EXPECTED_FILE);
  });

  test.each(INVOCATIONS)('%s also pins the project name and directory', async (name) => {
    await invoke(name);
    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args[args.indexOf('-p') + 1]).toBe(CTX.projectName);
    expect(args[args.indexOf('--project-directory') + 1]).toBe(CTX.dir);
  });
});

describe('C8 — structural guard against a new unpinned call site', () => {
  test('dockerode.ts builds compose argv in exactly one place', async () => {
    const source = await readFile(path.join(SRC, 'dockerode.ts'), 'utf8');
    const constructionSites = source.match(/'compose',/g) ?? [];
    expect(
      constructionSites,
      'a second compose argv literal appeared — route it through composeArgs() instead',
    ).toHaveLength(1);
    expect(source).toMatch(/function composeArgs[\s\S]*?'-f',/);
  });

  test('every compose argv literal in the package includes -f', async () => {
    for (const file of ['dockerode.ts', 'compose-template.ts']) {
      const source = await readFile(path.join(SRC, file), 'utf8');
      const arrays = source.match(/\[\s*'compose',[\s\S]*?\]/g) ?? [];
      expect(arrays.length, `${file} has no compose invocation to check`).toBeGreaterThan(0);
      for (const arr of arrays) {
        expect(arr, `unpinned compose invocation in ${file}`).toContain("'-f'");
      }
    }
  });
});

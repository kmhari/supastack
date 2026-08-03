/**
 * C9 / FR-007 — an environment file that assigns a stack-selection variable
 * does not change which stack loads.
 *
 * This is the research.md Q1 reproduction, promoted from a one-off shell
 * session into the suite. It is the one place the feature asserts Compose's
 * BEHAVIOUR rather than our argv, and it earns that by running against the real
 * binary: the claim "pinning `-f` makes the redirect inert" is otherwise just a
 * reading of the documentation.
 *
 * SAFETY: `docker compose config` only. The attacker fixture declares
 * `privileged: true` and a `/:/host` bind precisely so that a future edit which
 * changes `config` to `up` fails loudly in review. Nothing here starts a
 * container, and the assertions read rendered YAML, not running state.
 *
 * Skips when Docker is unavailable rather than failing — this is a property of
 * the environment, not of the code under test.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { renderEnvFile } from '../../packages/docker-control/src/env-writer.js';

const run = promisify(execFile);

const BENIGN_STACK = `services:
  benign:
    image: alpine
    environment:
      ORG: \${STUDIO_DEFAULT_ORGANIZATION}
`;

// Deliberately alarming. If this ever renders into a running container, the
// blast radius is the host — which is exactly what SEC-064 was.
const ATTACKER_STACK = `services:
  pwn:
    image: alpine
    privileged: true
    pid: host
    volumes:
      - /:/host
`;

let dir: string;

// Probed synchronously at module scope: `describe.skipIf` is evaluated during
// collection, before any hook has run, so an async probe would silently skip
// the whole file on a machine that does have Docker.
const dockerAvailable =
  spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

/** Service names in a rendered `docker compose config`, in file order. */
function servicesOf(configYaml: string): string[] {
  const services: string[] = [];
  let inServices = false;
  for (const line of configYaml.split('\n')) {
    if (/^services:/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^\S/.test(line)) break;
    const match = inServices && /^ {2}(\w[\w.-]*):\s*$/.exec(line);
    if (match) services.push(match[1]);
  }
  return services;
}

async function composeConfig(args: string[]): Promise<string> {
  const { stdout } = await run('docker', ['compose', ...args, 'config'], { cwd: dir });
  return stdout;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'compose-redirect-'));
  await writeFile(path.join(dir, 'docker-compose.yml'), BENIGN_STACK);
  await writeFile(path.join(dir, 'attacker.yml'), ATTACKER_STACK);
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!dockerAvailable)('compose stack-file redirect', () => {
  const INJECTED = 'STUDIO_DEFAULT_ORGANIZATION=abc\nCOMPOSE_FILE=attacker.yml\n';

  test('control: a clean env file resolves the intended stack', async () => {
    await writeFile(path.join(dir, '.env'), 'STUDIO_DEFAULT_ORGANIZATION=abc\n');
    expect(servicesOf(await composeConfig([]))).toEqual(['benign']);
  });

  test('the primitive is real: unpinned, an injected env file swaps the whole stack', async () => {
    await writeFile(path.join(dir, '.env'), INJECTED);
    // No -f. This is what the platform did before feature 121, via the
    // auto-loaded .env — not only via an explicit --env-file.
    expect(servicesOf(await composeConfig([]))).toEqual(['pwn']);
  });

  test('C9: pinned with -f, the same injected env file is inert', async () => {
    await writeFile(path.join(dir, '.env'), INJECTED);
    expect(servicesOf(await composeConfig(['-f', 'docker-compose.yml']))).toEqual(['benign']);
  });

  test('C9: the platform argv shape resolves the intended stack', async () => {
    await writeFile(path.join(dir, '.env'), INJECTED);
    const argv = [
      '-p',
      'supastack-abcdefghij0123456789',
      '--project-directory',
      dir,
      '-f',
      path.join(dir, 'docker-compose.yml'),
    ];
    const rendered = await composeConfig(argv);
    expect(servicesOf(rendered)).toEqual(['benign']);
    expect(rendered).not.toContain('privileged');
    expect(rendered).toMatch(/^name: supastack-abcdefghij0123456789$/m);
  });

  test('and the round-trip check alone would NOT have caught it (research Q1)', async () => {
    await writeFile(path.join(dir, '.env'), INJECTED);
    // `config -q` exits 0 against the attacker's stack: it validates whichever
    // file the redirect selected. Keep the check, do not rely on it (D4).
    await expect(run('docker', ['compose', 'config', '-q'], { cwd: dir })).resolves.toBeDefined();
  });
});

describe.skipIf(!dockerAvailable)('FR-008 — values reach the container literally', () => {
  test('a $ in an env value expands against the host process environment', async () => {
    // The threat, demonstrated: this is SEC-065's mechanism.
    await writeFile(path.join(dir, '.env'), 'STUDIO_DEFAULT_ORGANIZATION=leak-${HOME}\n');
    const rendered = await composeConfig(['-f', 'docker-compose.yml']);
    expect(rendered).toContain('leak-');
    expect(rendered).not.toContain('${HOME}');
  });

  test('the writer refuses to produce such a file in the first place', () => {
    expect(() =>
      renderEnvFile({ generated: {}, operator: { STUDIO_DEFAULT_ORGANIZATION: 'leak-${HOME}' } }),
    ).toThrow(/STUDIO_DEFAULT_ORGANIZATION/);
  });
});

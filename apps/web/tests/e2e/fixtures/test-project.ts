import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Test-project fixture.
 *
 * Spec: specs/021-dashboard-browser-tests/data-model.md §5
 * Plan: specs/021-dashboard-browser-tests/plan.md §A4
 * Task: T007
 *
 * Returns the ref of a project the suite uses across spec files. Creates one
 * on first call via `POST /api/v1/instances`, then caches in
 * `globalThis.__e2eTestProjectRef` so subsequent tests reuse the same
 * project (avoiding repeated container provisioning even in the
 * fake-docker-control mode).
 */

const PROJECT_NAME = 'e2e-test-project';
const STORAGE_STATE_PATH = resolve(
  process.cwd(),
  'tests/e2e/.auth/admin-storage-state.json',
);

declare global {
  var __e2eTestProjectRef: string | undefined;
}

export async function testProjectRef(
  apiBaseUrl: string = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
): Promise<string> {
  if (globalThis.__e2eTestProjectRef) {
    return globalThis.__e2eTestProjectRef;
  }
  // Operator-supplied: skip creation entirely (useful when targeting a
  // deployed environment with the SELFBASE_TEST_FAKE_DOCKER hook unavailable).
  if (process.env.PLAYWRIGHT_TEST_PROJECT_REF) {
    globalThis.__e2eTestProjectRef = process.env.PLAYWRIGHT_TEST_PROJECT_REF;
    return process.env.PLAYWRIGHT_TEST_PROJECT_REF;
  }

  const cookieHeader = await loadCookieHeader();

  // Try to find an existing test project first — surviving test runs reuse it.
  const listResp = await fetch(`${apiBaseUrl}/api/v1/instances`, {
    headers: { Cookie: cookieHeader },
  });
  if (listResp.ok) {
    const list = (await listResp.json()) as Array<{ name: string; ref: string }>;
    const existing = list.find((i) => i.name === PROJECT_NAME);
    if (existing) {
      globalThis.__e2eTestProjectRef = existing.ref;
      return existing.ref;
    }
  }

  const resp = await fetch(`${apiBaseUrl}/api/v1/instances`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ name: PROJECT_NAME, backupRetain: 7 }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Could not create test project: HTTP ${resp.status} ${resp.statusText}\n${text}\n` +
        `Verify SELFBASE_TEST_FAKE_DOCKER=1 is set on the api process.`,
    );
  }
  const body = (await resp.json()) as { ref: string };
  globalThis.__e2eTestProjectRef = body.ref;
  return body.ref;
}

/**
 * Reads the persisted storage state and rebuilds a Cookie header. Tests that
 * call `testProjectRef()` from outside Playwright's browser context (e.g.
 * from a `beforeAll` hook) need this since fetch doesn't share cookie jars
 * with Playwright contexts.
 */
async function loadCookieHeader(): Promise<string> {
  try {
    const raw = await readFile(STORAGE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { cookies: Array<{ name: string; value: string }> };
    return parsed.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (err) {
    throw new Error(
      `Could not load admin storage state from ${STORAGE_STATE_PATH}: ${(err as Error).message}. ` +
        `Make sure admin-session.ts has run first (it usually does via the test fixture).`,
    );
  }
}

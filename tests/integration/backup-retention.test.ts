import { describe, expect, test } from 'vitest';

/**
 * Retention invariant: with retention=N, after the (N+1)th successful
 * backup the platform holds exactly N. SC-007.
 */
const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const REF = process.env.TEST_INSTANCE_REF;

async function listCompleted(api: string, token: string, ref: string): Promise<number> {
  const r = await fetch(`${api}/api/v1/instances/${ref}/backups`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const rows = (await r.json()) as Array<{ status: string }>;
  return rows.filter((b) => b.status === 'completed').length;
}

async function waitFor<T>(
  fn: () => Promise<T>,
  until: (v: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = await fn();
  while (!until(v)) {
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 2_000));
    v = await fn();
  }
  return v;
}

describe.skipIf(!API || !TOKEN_ADMIN || !REF)('Retention invariant (SC-007)', () => {
  test('with retention=3, after 4 backups only 3 remain', async () => {
    const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` };

    // 1. Set retention to 3
    await fetch(`${API}/api/v1/instances/${REF}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ backupRetain: 3 }),
    });

    // 2. Trigger 4 backups, waiting for each to complete before the next
    const initialCount = await listCompleted(API!, TOKEN_ADMIN!, REF!);
    for (let i = 1; i <= 4; i++) {
      await fetch(`${API}/api/v1/instances/${REF}/backups`, { method: 'POST', headers: H });
      await waitFor(
        () => listCompleted(API!, TOKEN_ADMIN!, REF!),
        (n) => n >= initialCount + Math.min(i, 3),
        60_000,
      );
    }

    // 3. After the 4th backup completes, retention sweep should have
    // removed the oldest. Final count = exactly 3.
    const final = await waitFor(
      () => listCompleted(API!, TOKEN_ADMIN!, REF!),
      (n) => n === 3,
      30_000,
    );
    expect(final).toBe(3);
  }, /* timeout */ 300_000);
});

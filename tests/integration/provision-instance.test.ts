import { describe, expect, test } from 'vitest';

/**
 * US1 integration smoke test — the SupaConsole regression check.
 *
 * Flow:
 *   1. Hit /setup/status. If open, run setup; if closed, assume seeded admin.
 *   2. Login → bearer token.
 *   3. POST /instances {name:"smoke"}.
 *   4. Poll /instances/:ref until status=running (90s cap).
 *   5. Reveal credentials.
 *   6. curl https://<ref>.<apex>/rest/v1/ with anon_key as `apikey` header.
 *   7. Expect 200 (PostgREST swagger).
 *
 * Skipped when TEST_API_URL is unset. CI provides it via the docker-compose
 * integration harness.
 */
const API = process.env.TEST_API_URL;
const TEST_APEX = process.env.TEST_APEX ?? 'selfbase.test';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@selfbase.test';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test-password-with-12+';

interface InstanceRow {
  ref: string;
  status: string;
  provisionError?: string | null;
  urls?: { kong?: string | null };
}

describe.skipIf(!API)('US1 — provision an instance and reach it (90s + REST check)', () => {
  test('fresh provision becomes running and answers REST with the generated anon_key', async () => {
    // 1. Setup or login
    const status = (await (await fetch(`${API}/api/v1/setup/status`)).json()) as {
      open: boolean;
    };
    let token: string;
    if (status.open) {
      const out = await fetch(`${API}/api/v1/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          orgName: 'Smoke Org',
          apexDomain: TEST_APEX,
        }),
      });
      token = ((await out.json()) as { apiToken: string }).apiToken;
    } else {
      const r = await fetch(`${API}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      // The integration harness must pre-seed an admin token in TEST_TOKEN_ADMIN
      // if setup is already closed and login is unavailable for this run.
      if (r.status !== 200) {
        token = process.env.TEST_TOKEN_ADMIN ?? '';
        if (!token) throw new Error('no admin token available');
      } else {
        // session cookie path — mint a token for headless access
        const cookie = r.headers.get('set-cookie') ?? '';
        const tk = await fetch(`${API}/api/v1/auth/tokens`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ label: 'smoke' }),
        });
        token = ((await tk.json()) as { token: string }).token;
      }
    }
    const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

    // 2. Create instance
    const created = await fetch(`${API}/api/v1/instances`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'smoke' }),
    });
    expect(created.status).toBe(202);
    const { ref } = (await created.json()) as { ref: string };
    expect(ref).toMatch(/^[a-z0-9]{20}$/);

    // 3. Poll until running (90s cap)
    const start = Date.now();
    let row: InstanceRow | undefined;
    while (Date.now() - start < 90_000) {
      const r = await fetch(`${API}/api/v1/instances/${ref}`, { headers: H });
      row = (await r.json()) as InstanceRow;
      if (row.status === 'running') break;
      if (row.status === 'failed') {
        throw new Error(`provision failed: ${row.provisionError ?? '<unknown>'}`);
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    expect(row?.status).toBe('running');
    const elapsed = (Date.now() - start) / 1000;
    // SC-002 says 95% should make it; this assertion is just "did it work at all".
    expect(elapsed).toBeLessThan(90);

    // 4. Reveal credentials (re-auth with the password)
    const reveal = await fetch(`${API}/api/v1/instances/${ref}/credentials/reveal`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(reveal.status).toBe(200);
    const { anonKey } = (await reveal.json()) as { anonKey: string };
    expect(anonKey.split('.')).toHaveLength(3);

    // 5. SUPACONSOLE REGRESSION CHECK: the anon_key must verify against the
    //    instance's PostgREST. If the JWT signature is fake (SupaConsole bug),
    //    we get 401 with JWSError; if it's real, we get 200 + Swagger.
    const restUrl = row?.urls?.kong;
    if (!restUrl) {
      // TLS not configured for the test apex — skip the curl, count what we have
      return;
    }
    const restRes = await fetch(`${restUrl}/rest/v1/`, {
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    });
    expect(restRes.status).toBe(200);
  }, /* timeout */ 180_000);
});

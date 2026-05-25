import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { createECDH, createDecipheriv } from 'node:crypto';
import { cliLoginRoutes } from '../../src/routes/cli-login.js';
import { platformCliLoginRoutes } from '../../src/routes/platform-cli-login.js';
import { setRedisForTesting } from '../../src/services/cli-login-store.js';

/**
 * End-to-end integration: mint a PAT via POST /api/v1/cli/login, then poll
 * GET /platform/cli/login/:id with the dashboard-issued device_code, decrypt
 * the returned bundle with the CLIENT private key, recover the PAT plaintext.
 *
 * This is the "if this test fails, supabase login doesn't work" test.
 */

class FakeRedis {
  private store = new Map<string, string>();
  async set(k: string, v: string, _ex: 'EX', _ttl: number) { this.store.set(k, v); return 'OK' as const; }
  async get(k: string) { return this.store.get(k) ?? null; }
  async exists(k: string) { return this.store.has(k) ? 1 : 0; }
  async del(k: string) { return this.store.delete(k) ? 1 : 0; }
}

let mintedPlaintext = '';

vi.mock('@selfbase/db', () => ({
  db: () => ({
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: '00000000-0000-0000-0000-0000000000aa' }],
      }),
    }),
  }),
  schema: { apiTokens: {} },
}));

// Capture the plaintext PAT that mintApiToken returns by spying on its module.
vi.mock('../../src/services/api-tokens.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/api-tokens.js')>(
    '../../src/services/api-tokens.js',
  );
  return {
    ...actual,
    mintApiToken: vi.fn(async (...args: Parameters<typeof actual.mintApiToken>) => {
      const result = await actual.mintApiToken(...args);
      mintedPlaintext = result.raw;
      return result;
    }),
  };
});

describe('CLI device-code login — end-to-end round-trip', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRedisForTesting(new FakeRedis() as any);
    mintedPlaintext = '';
  });

  it('mint → poll → decrypt with client priv key recovers the PAT plaintext', async () => {
    // Simulate the CLI generating its ECDH keypair.
    const cliEcdh = createECDH('prime256v1');
    cliEcdh.generateKeys();
    const cliPubHex = cliEcdh.getPublicKey().toString('hex');

    // Build the mint app (with auth stub).
    const mintApp = Fastify();
    mintApp.decorate('requireAuth', () => ({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'op@example.com',
      role: 'admin' as const,
    }));
    await mintApp.register(cliLoginRoutes);
    await mintApp.ready();

    const sessionId = '21f7bcf6-d8a6-43a0-b9d7-74f568073cf5';
    const mintRes = await mintApp.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: {
        session_id: sessionId,
        token_name: 'cli_round@trip.local_1779700000',
        public_key: cliPubHex,
      },
    });
    expect(mintRes.statusCode).toBe(200);
    const { device_code } = JSON.parse(mintRes.body) as { device_code: string };
    expect(device_code).toMatch(/^[0-9a-f]{8}$/);
    expect(mintedPlaintext).toMatch(/^sbp_[0-9a-f]{40}$/);
    await mintApp.close();

    // CLI polls.
    const pollApp = Fastify();
    await pollApp.register(platformCliLoginRoutes);
    await pollApp.ready();

    const pollRes = await pollApp.inject({
      method: 'GET',
      url: `/platform/cli/login/${sessionId}?device_code=${device_code}`,
    });
    expect(pollRes.statusCode).toBe(200);
    const bundle = JSON.parse(pollRes.body) as {
      id: string;
      created_at: string;
      access_token: string;
      public_key: string;
      nonce: string;
    };

    expect(bundle.id).toBe(sessionId);
    expect(bundle.public_key).toMatch(/^04[0-9a-f]{128}$/);
    expect(bundle.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(bundle.access_token).toMatch(/^[0-9a-f]+$/);

    // Decrypt as the CLI would.
    const serverPub = Buffer.from(bundle.public_key, 'hex');
    const sharedSecret = cliEcdh.computeSecret(serverPub);
    const nonce = Buffer.from(bundle.nonce, 'hex');
    const allBytes = Buffer.from(bundle.access_token, 'hex');
    const tag = allBytes.subarray(allBytes.length - 16);
    const ct = allBytes.subarray(0, allBytes.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', sharedSecret, nonce);
    decipher.setAuthTag(tag);
    const recovered = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');

    expect(recovered).toBe(mintedPlaintext);
    await pollApp.close();
  });
});

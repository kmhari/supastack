// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * This installation is invite-only. There is exactly ONE way an account is
 * created without an existing account: POST /setup, which is gated by
 * `setup_state.completed_at` and returns 410 forever after the first run.
 * Everything afterwards goes through an org admin's invitation.
 *
 * The removed POST /platform/signup was unauthenticated and minted a user plus
 * a fresh organization owned by the caller. It was inert in practice only
 * because the control-plane GoTrue hardcodes GOTRUE_DISABLE_SIGNUP=true — a
 * public door held shut by one env var.
 *
 * This is a ratchet, not a snapshot. It fails if a route path containing
 * "signup" reappears in the api, or if anything reaches for GoTrue's public
 * /signup endpoint again.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function gitGrep(args: string[], paths: string[]): string[] {
  let out: string;
  try {
    out = execFileSync('git', ['grep', '-l', ...args, '--', ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    // git grep exits 1 with no output when there are zero matches.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out.split('\n').filter(Boolean).sort();
}

describe('invite-only — no open signup', () => {
  it('registers no route whose path contains "signup"', () => {
    // Matches a quoted route-path literal, not the word in prose or in a
    // GoTrue config field name (`disable_signup` is a legitimate per-project
    // setting the env mapper forwards). Fastify puts the path on its own line
    // for multi-line handlers, so a same-line `.post(` pattern would miss it.
    expect(gitGrep(['-E', '[\'"]/[^\'"]*signup'], ['apps/api/src/**'])).toEqual([]);
  });

  it("nothing calls GoTrue's public /signup endpoint", () => {
    expect(
      gitGrep(['--fixed-strings', 'signupGotrueUser'], ['apps/*/src/**', 'packages/*/src/**']),
    ).toEqual([]);
    expect(gitGrep(['-E', '\\$\\{GOTRUE_URL\\}/signup'], ['apps/*/src/**'])).toEqual([]);
  });

  it('the control-plane GoTrue still disables signup at the container level', () => {
    // Defence in depth: even with no api route, GoTrue must refuse direct
    // POSTs to /auth/v1/signup, which Caddy exposes on the apex host.
    expect(
      gitGrep(['--fixed-strings', "GOTRUE_DISABLE_SIGNUP: 'true'"], ['infra/docker-compose.yml']),
    ).toEqual(['infra/docker-compose.yml']);
  });

  it('setup remains the single bootstrap path and stays gated', () => {
    // If this ever stops matching, the one-shot gate has moved or been removed
    // and /setup would become a permanent open signup.
    expect(
      gitGrep(['--fixed-strings', 'errors.setupComplete()'], ['apps/api/src/routes/setup.ts']),
    ).toEqual(['apps/api/src/routes/setup.ts']);
  });
});

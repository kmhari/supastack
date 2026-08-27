// boot-for-dump.mts — boot the api far enough to register every route, then exit.
//
// Driven by scripts/studio-sync/dump-routes.sh, which supplies the throwaway
// DB/Redis and SUPASTACK_DUMP_ROUTES. The manifest itself is written by the
// `onRoute`/`onReady` hooks in apps/api/src/server.ts; this file only supplies
// the env buildApp()'s preflight demands and drives it to `ready()`.
//
// The credentials below are deliberately random per run: nothing is persisted,
// the containers are destroyed on exit, and no real secret should ever be
// needed to enumerate routes.

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.SUPASTACK_DUMP_ROUTES) {
  console.error('FATAL: SUPASTACK_DUMP_ROUTES is not set — run via dump-routes.sh');
  process.exit(2);
}

process.env.DATABASE_URL = process.env.DUMP_DATABASE_URL;
process.env.REDIS_URL = process.env.DUMP_REDIS_URL;
process.env.MASTER_KEY = randomBytes(32).toString('hex');
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.COOKIE_SECURE = '0';
// Keep first-boot cert/volume scaffolding out of /var/supastack.
process.env.INSTANCES_DIR = mkdtempSync(join(tmpdir(), 'supastack-dump-'));

const { buildApp } = await import('../../apps/api/src/server.js');
const app = await buildApp();
await app.ready(); // fires the onReady hook that writes the manifest
await app.close();
process.exit(0);

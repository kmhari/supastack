#!/usr/bin/env node
// Copy the canonical reserved-secrets list into the per-instance functions
// volume so the Deno runtime can read it without crossing back to the api.
// Re-run on every api/worker build.
//
// Spec: 010-secrets-management — research.md Decision 4 + T003.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../src/reserved-secrets.json');
const target = resolve(
  here,
  '../../../infra/supabase-template/volumes/functions/main/reserved-secrets.json',
);

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[reserved-secrets] copied ${source} → ${target}`);

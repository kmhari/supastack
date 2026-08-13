#!/usr/bin/env node
// api-contract-diff.mjs — what a Studio upgrade would demand of our api.
//
// The two source patches are ~106 lines. The real coupling to upstream is that
// a rebuilt Studio bundle calls whatever upstream Studio now calls, and supastack's
// api has to answer it: 333 `/platform/*` paths, none of which we control.
//
// Upstream's `packages/api-types/types/platform.d.ts` is the generated contract
// Studio is typed against, so diffing it between the commit our current image was
// built from and upstream head tells us exactly which endpoints a sync would move
// under us — before we build the image, not after an operator hits a 404.
//
// Usage:
//   node scripts/studio-sync/api-contract-diff.mjs <supabase-checkout-dir> [options]
//
//   --base <ref>     contract our current Studio was built against
//                    (default: merge-base of upstream master and the patch branch)
//   --head <ref>     contract we would move to (default: upstream master)
//   --api-dir <dir>  supastack api routes (default: ./apps/api/src/routes)
//   --json           emit machine-readable findings instead of the report
//
// Exit: 0 no actionable drift | 1 endpoints we implement moved | 2 usage error

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

const TYPES_FILE = 'packages/api-types/types/platform.d.ts';
const UPSTREAM_REPO = 'supabase/supabase';
const FORK_REPO = 'kmhari/supabase';
const PATCH_BRANCH = 'supastack-studio';
const MAIN_BRANCH = 'master';

const argv = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') opts.json = true;
  else if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}

const dir = positional[0] ?? process.env.SUPABASE_FORK_DIR;
if (!dir) {
  console.error(`usage: ${process.argv[1]} <supabase-checkout-dir> [--base <ref>] [--head <ref>]`);
  process.exit(2);
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  } catch (err) {
    if (allowFail) return null;
    console.error(`FATAL: git ${args.join(' ')} failed in ${dir}\n${err.stderr ?? err.message}`);
    process.exit(2);
  }
}

function remoteFor(slug) {
  for (const line of git(['remote', '-v']).split('\n')) {
    const [name, url, kind] = line.split(/\s+/);
    if (kind === '(fetch)' && url && new RegExp(`${slug.replace('/', '\\/')}(\\.git)?$`).test(url))
      return name;
  }
  return null;
}

const upstreamRemote = remoteFor(UPSTREAM_REPO) ?? 'origin';
const forkRemote = remoteFor(FORK_REPO);

const head = opts.head ?? `${upstreamRemote}/${MAIN_BRANCH}`;
const base =
  opts.base ??
  (forkRemote
    ? git(['merge-base', head, `${forkRemote}/${PATCH_BRANCH}`], { allowFail: true })?.trim()
    : null) ??
  null;

if (!base) {
  console.error('FATAL: could not determine --base (fetch the fork, or pass --base <ref>)');
  process.exit(2);
}

// ------------------------------------------------- parse the generated contract

// Path keys sit at two-space indent inside `export interface paths`, and each
// block closes on a bare two-space `}`. Slicing on that is enough to compare
// operation shapes without pulling in a TypeScript parser.
function extractPaths(ref, typesFile, match) {
  const src = git(['show', `${ref}:${typesFile}`], { allowFail: true });
  if (src === null) {
    console.error(`FATAL: ${typesFile} missing at ${ref} — upstream moved the generated types`);
    process.exit(2);
  }
  const lines = src.split('\n');
  const out = new Map();
  let key = null;
  let buf = [];
  for (const line of lines) {
    const m = line.match(/^ {2}'(\/[^']*)': \{$/);
    if (m) {
      key = match.test(m[1]) ? m[1] : null;
      buf = [];
      continue;
    }
    if (key !== null) {
      if (line === '  }') {
        out.set(key, buf.join('\n'));
        key = null;
      } else {
        // Drop JSDoc/comment lines. Upstream rewords endpoint descriptions
        // constantly; a prose edit is not contract drift, and reporting it as
        // CHANGED buries the operations that actually moved.
        const t = line.trim();
        if (t && !/^(\/\*\*|\*\/|\*|\/\/)/.test(t)) buf.push(t);
      }
    }
  }
  return out;
}

// Fastify `:ref` and OpenAPI `{ref}` describe the same slot, and the two sides
// disagree on parameter NAMES constantly (`{id}` vs `:connectionId`). Compare on
// shape so a naming difference is not reported as a missing endpoint.
const shape = (p) => p.replace(/\{[^}]*\}/g, '{}').replace(/:[A-Za-z0-9_]+/g, '{}');

// `mount` is what Fastify prepends at registration time. The /platform routes
// carry their full path in the literal; everything under routes/management/ is
// registered with `{ prefix: '/v1' }` (server.ts) and its literals are RELATIVE,
// so scanning for '/v1/...' strings there finds nothing. Prepend the mount or the
// entire Management API compatibility surface reads as unimplemented.
function collectRoutes(root, { match, mount = '' }) {
  const found = new Map();
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|mts|js|mjs)$/.test(entry)) {
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/['"`](\/[^'"`\s]*)['"`]/g)) {
          const path = mount + m[1];
          if (!match.test(path)) continue;
          const s = shape(path);
          if (!found.has(s)) found.set(s, { path, file: full });
        }
      }
    }
  };
  walk(root);
  return found;
}

// Two independent contracts, and missing either one hides real breakage:
//   platform — what the Studio bundle calls; our api is the only thing serving it
//   v1       — the Management API compatibility surface. Per AGENTS.md upstream is
//              canonical here and we must never invent or drift it. It is also what
//              the unmodified supabase CLI and MCP clients talk to.
const SURFACES = [
  {
    name: 'platform',
    types: 'packages/api-types/types/platform.d.ts',
    match: /^\/platform\//,
    routeDir: 'apps/api/src/routes',
    mount: '',
    consumer: 'a rebuilt Studio may 404',
  },
  {
    name: 'v1 (Management API)',
    types: 'packages/api-types/types/api.d.ts',
    match: /^\/v1\//,
    routeDir: 'apps/api/src/routes/management',
    mount: '/v1',
    consumer: 'the supabase CLI / MCP clients hit the 501 catch-all',
  },
];

const apiRoot = resolvePath(opts['api-dir'] ?? 'apps/api/src/routes');

function analyse(surface) {
  const basePaths = extractPaths(base, surface.types, surface.match);
  const headPaths = extractPaths(head, surface.types, surface.match);

  const dir = surface.mount === '' ? apiRoot : resolvePath(surface.routeDir);
  let routes;
  try {
    routes = collectRoutes(dir, { match: surface.match, mount: surface.mount });
  } catch (err) {
    console.error(`FATAL: cannot read supastack routes at ${dir}: ${err.message}`);
    process.exit(2);
  }

  const baseByShape = new Map([...basePaths].map(([p, body]) => [shape(p), { path: p, body }]));
  const headByShape = new Map([...headPaths].map(([p, body]) => [shape(p), { path: p, body }]));

  const removed = []; // we implement it; upstream deleted it
  const changed = []; // we implement it; upstream reshaped it
  const added = []; // upstream added it; we do not implement it

  for (const [s, impl] of routes) {
    const inBase = baseByShape.get(s);
    const inHead = headByShape.get(s);
    if (inBase && !inHead)
      removed.push({ path: impl.path, file: impl.file, upstream: inBase.path });
    else if (inBase && inHead && inBase.body !== inHead.body)
      changed.push({ path: impl.path, file: impl.file, upstream: inHead.path });
  }

  for (const [s, up] of headByShape) {
    if (!baseByShape.has(s) && !routes.has(s)) added.push({ path: up.path });
  }

  return {
    surface: surface.name,
    consumer: surface.consumer,
    counts: {
      upstreamBase: basePaths.size,
      upstreamHead: headPaths.size,
      implemented: routes.size,
    },
    removed,
    changed,
    added,
  };
}

const reports = SURFACES.map(analyse);
const actionable = reports.reduce((n, r) => n + r.removed.length + r.changed.length, 0);

if (opts.json) {
  console.log(JSON.stringify({ base, head, surfaces: reports }, null, 2));
  process.exit(actionable ? 1 : 0);
}

const rel = (f) => f.replace(process.cwd() + '/', '');

console.log(`\nAPI contract drift`);
console.log(`  base ${base.slice(0, 10)}  ->  head ${head}`);

let added = [];
for (const r of reports) {
  added = added.concat(r.added);
  console.log(`\n── ${r.surface} ─────────────────────────────────────────`);
  console.log(
    `  ${r.counts.upstreamBase} -> ${r.counts.upstreamHead} upstream paths | ${r.counts.implemented} implemented by supastack\n`,
  );

  if (r.removed.length) {
    console.log(`  BREAKING — we implement it, upstream deleted it (${r.removed.length})`);
    for (const x of r.removed) console.log(`    ${x.path}\n      ${rel(x.file)}`);
    console.log();
  }
  if (r.changed.length) {
    console.log(
      `  CHANGED — we implement it, upstream reshaped the operation (${r.changed.length})`,
    );
    for (const x of r.changed) console.log(`    ${x.path}\n      ${rel(x.file)}`);
    console.log();
  }
  if (r.added.length) {
    console.log(`  NEW upstream, not implemented here — ${r.consumer} (${r.added.length})`);
    for (const x of r.added) console.log(`    ${x.path}`);
    console.log();
  }
  if (!r.removed.length && !r.changed.length && !r.added.length)
    console.log('  no drift on any endpoint supastack implements\n');
}

console.log(
  `  ${actionable} actionable finding(s)` +
    (added.length ? `, ${added.length} new upstream path(s) to triage` : '') +
    '\n',
);
process.exit(actionable ? 1 : 0);

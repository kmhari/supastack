#!/usr/bin/env node
// v1-contract-check.mjs — method-level drift against the real Management API spec.
//
// AGENTS.md makes upstream canonical for /v1/*: never invent or drift that
// surface. Upstream publishes it as actual OpenAPI JSON at
// https://api.supabase.com/api/v1-json — 115 paths, 148 schemas — so this
// compares against the spec itself rather than against generated .d.ts, and does
// it per METHOD. Path-level comparison is not enough: upstream retiring PUT and
// DELETE on a path we still serve all three verbs on is invisible unless you
// look at methods.
//
// (The /platform surface has no public JSON — api.supabase.com/api/platform-json
// is 404 — so it stays on studio-demand-diff.mjs, which reads Studio's real call
// sites instead.)
//
// Our side comes from the route manifest, which is Fastify's own onRoute output.
// Do not substitute a grep: it cannot see wildcards or prefixed mounts, and every
// route it misses shows up here as a false "upstream defines it, we don't".
//
// Usage:
//   scripts/studio-sync/dump-routes.sh route-manifest.json
//   node scripts/studio-sync/v1-contract-check.mjs [options]
//
//   --manifest <path>  route manifest (default: ./route-manifest.json)
//   --spec <path>      cached OpenAPI JSON (default: .cache/supabase-v1-openapi.json)
//   --refresh          re-fetch the spec from api.supabase.com first
//   --json             machine-readable output
//
// Exit: 0 nothing breaking | 1 invented path or divergent method | 2 usage

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SPEC_URL = 'https://api.supabase.com/api/v1-json';

const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json' || argv[i] === '--refresh') opts[argv[i].slice(2)] = true;
  else if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
}

const manifestPath = resolve(opts.manifest ?? 'route-manifest.json');
const specPath = resolve(opts.spec ?? '.cache/supabase-v1-openapi.json');

if (opts.refresh) {
  const res = await fetch(SPEC_URL);
  if (!res.ok) {
    console.error(`FATAL: ${SPEC_URL} returned ${res.status}`);
    process.exit(2);
  }
  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(specPath, JSON.stringify(await res.json(), null, 2));
}

let spec, manifest;
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
} catch (err) {
  console.error(`FATAL: cannot read spec at ${specPath}: ${err.message}`);
  console.error(`       fetch it: ${process.argv[1]} --refresh`);
  process.exit(2);
}
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`FATAL: cannot read route manifest at ${manifestPath}: ${err.message}`);
  console.error('       generate it: scripts/studio-sync/dump-routes.sh');
  process.exit(2);
}

// Fastify `:ref` vs OpenAPI `{ref}`, and the two sides disagree on parameter
// names constantly. Compare on shape.
const shape = (p) => p.replace(/\{[^}]*\}/g, '{}').replace(/:[A-Za-z0-9_]+/g, '{}');
const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

// upstream: shaped path -> { methods:Set, display:string }
const upstream = new Map();
for (const [path, item] of Object.entries(spec.paths)) {
  const key = shape(path);
  if (!upstream.has(key)) upstream.set(key, { methods: new Set(), display: path });
  for (const verb of VERBS) if (item[verb]) upstream.get(key).methods.add(verb.toUpperCase());
}

// ours: shaped path -> { methods:Set, display:string }
const ours = new Map();
for (const { method, url } of manifest) {
  if (method === 'HEAD' || method === 'OPTIONS') continue;
  if (!url.startsWith('/v1/')) continue;
  // The catch-all in management/not-implemented.ts answers everything unmatched
  // with a structured 501. It is deliberate (FR-024), not implemented surface.
  if (url === '/v1/*' || url.endsWith('/*')) continue;
  const key = shape(url);
  if (!ours.has(key)) ours.set(key, { methods: new Set(), display: url });
  ours.get(key).methods.add(method);
}

const inventedPath = []; // we serve a /v1 path upstream does not define at all
const divergent = []; // we answer a verb upstream lacks AND miss one it defines
const extra = []; // every canonical verb is served; we just answer more besides
const notImplemented = []; // upstream defines it, we fall through to the 501

// Serving a verb upstream does not define is not automatically breakage. If every
// verb upstream DOES define is also served, a spec-conformant client never
// notices the extra one — e.g. we answer PATCH on config/database/postgres
// alongside upstream's PUT, and the CLI uses PUT. That is an extension to
// justify, not a break.
//
// It only breaks when the canonical verbs are missing, because then a client
// following the spec falls through to the 501 catch-all while a non-standard
// verb quietly works.
for (const [key, mine] of ours) {
  const up = upstream.get(key);
  if (!up) {
    inventedPath.push({ path: mine.display, methods: [...mine.methods].sort() });
    continue;
  }
  const canonicalCovered = [...up.methods].every((m) => mine.methods.has(m));
  for (const m of [...mine.methods].sort()) {
    if (up.methods.has(m)) continue;
    const row = {
      path: mine.display,
      method: m,
      upstream: [...up.methods].sort().join(',') || '(none)',
    };
    (canonicalCovered ? extra : divergent).push(row);
  }
}
for (const [key, up] of upstream) {
  const mine = ours.get(key);
  for (const m of [...up.methods].sort()) {
    if (!mine || !mine.methods.has(m)) notImplemented.push({ path: up.display, method: m });
  }
}

const breaking = inventedPath.length + divergent.length;

if (opts.json) {
  console.log(
    JSON.stringify(
      { spec: specPath, manifest: manifestPath, inventedPath, divergent, extra, notImplemented },
      null,
      2,
    ),
  );
  process.exit(breaking ? 1 : 0);
}

console.log(`\n/v1 Management API contract`);
console.log(
  `  spec     ${specPath} (${Object.keys(spec.paths).length} paths, ${Object.keys(spec.components.schemas).length} schemas)`,
);
console.log(`  manifest ${manifestPath} (${ours.size} /v1 paths served)\n`);

if (inventedPath.length) {
  console.log(
    `  INVENTED PATH — we serve it, upstream does not define it (${inventedPath.length})`,
  );
  console.log(`    AGENTS.md: never invent or drift the /v1 surface.`);
  for (const x of inventedPath) console.log(`    ${x.methods.join(',')} ${x.path}`);
  console.log();
}
if (divergent.length) {
  console.log(`  DIVERGENT METHOD — we answer a verb upstream lacks, and miss one it defines`);
  console.log(`    A spec-conformant client hits the 501 while a non-standard verb works.`);
  for (const x of divergent) console.log(`    ${x.method} ${x.path}   (upstream: ${x.upstream})`);
  console.log();
}
if (extra.length) {
  console.log(`  EXTRA METHOD — every canonical verb served, plus this one (${extra.length})`);
  console.log(`    Non-breaking. Each still wants a documented reason for existing.`);
  for (const x of extra) console.log(`    ${x.method} ${x.path}   (upstream: ${x.upstream})`);
  console.log();
}
if (notImplemented.length) {
  console.log(`  NOT IMPLEMENTED — upstream defines it, we answer 501 (${notImplemented.length})`);
  console.log(
    `    Deliberate per FR-024. Listed so the gap is visible, not to be fixed wholesale.`,
  );
  const byPrefix = new Map();
  for (const x of notImplemented) {
    const p = (x.path.match(/^(\/v1\/[^/]+)/) ?? [, x.path])[1];
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }
  for (const [p, n] of [...byPrefix].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(3)}  ${p}/*`);
  }
  console.log();
}
if (!breaking) console.log('  no invented /v1 surface\n');

console.log(
  `  ${breaking} breaking, ${extra.length} non-breaking extension(s), ${notImplemented.length} unimplemented\n`,
);
process.exit(breaking ? 1 : 0);

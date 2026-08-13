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
// Exit: 0 no invented surface | 1 we serve something upstream does not define | 2 usage

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
const inventedMethod = []; // path exists upstream, but not this verb
const notImplemented = []; // upstream defines it, we fall through to the 501

for (const [key, mine] of ours) {
  const up = upstream.get(key);
  if (!up) {
    inventedPath.push({ path: mine.display, methods: [...mine.methods].sort() });
    continue;
  }
  for (const m of [...mine.methods].sort()) {
    if (!up.methods.has(m))
      inventedMethod.push({ path: mine.display, method: m, upstream: up.display });
  }
}
for (const [key, up] of upstream) {
  const mine = ours.get(key);
  for (const m of [...up.methods].sort()) {
    if (!mine || !mine.methods.has(m)) notImplemented.push({ path: up.display, method: m });
  }
}

const invented = inventedPath.length + inventedMethod.length;

if (opts.json) {
  console.log(
    JSON.stringify(
      { spec: specPath, manifest: manifestPath, inventedPath, inventedMethod, notImplemented },
      null,
      2,
    ),
  );
  process.exit(invented ? 1 : 0);
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
if (inventedMethod.length) {
  console.log(`  INVENTED METHOD — path is upstream, this verb is not (${inventedMethod.length})`);
  for (const x of inventedMethod) console.log(`    ${x.method} ${x.path}`);
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
if (!invented) console.log('  no invented /v1 surface\n');

console.log(`  ${invented} contract violation(s), ${notImplemented.length} unimplemented\n`);
process.exit(invented ? 1 : 0);

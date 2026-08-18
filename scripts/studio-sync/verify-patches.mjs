#!/usr/bin/env node
// verify-patches.mjs — assert the supastack Studio patches still do their job.
//
// A clean rebase does NOT prove a patch still works. Upstream can add a sixth
// auth provider right next to the five we disable; the rebase then either merges
// it in silently, or conflicts only because the new key happened to land between
// two lines we already touch. Adjacency luck is not a guard.
//
// So every assertion here is CLOSED-WORLD (deny by default): we assert over the
// whole `dashboard_auth:*` namespace rather than over a list of five known flags,
// which means a brand-new upstream flag fails the check on its own merit.
//
// Usage:
//   node scripts/studio-sync/verify-patches.mjs <checkout-dir> [options]
//
//   <checkout-dir>     any clone of kmhari/supabase or supabase/supabase
//   --ref <ref>        what to verify   (default: the fork's supastack-studio)
//   --base <ref>       upstream baseline for the file-set diff (default: upstream master)
//
// Verify the branch as published:   … verify-patches.mjs ~/Code/supabase/supabase
// Verify a rebase before pushing:   … verify-patches.mjs ~/Code/supabase/supabase --ref HEAD
//
// Exit: 0 all assertions pass | 1 an assertion failed | 2 usage/environment error

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const FORK_REPO = 'kmhari/supabase';
const UPSTREAM_REPO = 'supabase/supabase';
const PATCH_BRANCH = 'supastack-studio';
const MAIN_BRANCH = 'master';

// The complete set of files the patch branch is allowed to differ from upstream in.
// Adding a patch means adding its file here AND an entry in SUPASTACK-PATCHES.md.
const EXPECTED_PATCH_FILES = [
  'SUPASTACK-PATCHES.md',
  'apps/studio/components/interfaces/SignIn/ForgotPasswordWizard.tsx',
  'apps/studio/components/interfaces/SignIn/SignInForm.tsx',
  'packages/common/enabled-features/enabled-features.json',
];

const FLAGS_FILE = 'packages/common/enabled-features/enabled-features.json';
const FLAG_NAMESPACE = 'dashboard_auth:';
// The ONLY dashboard_auth flag allowed to stay true. Everything else in the
// namespace must be false — including flags upstream has not invented yet.
const FLAGS_ALLOWED_TRUE = new Set(['dashboard_auth:sign_in_with_email']);

// The unauthenticated auth surface — the only place an unguarded hCaptcha can
// lock an operator out. Billing/account components also render hCaptcha, but
// they sit behind a session on Cloud-only screens, so they are out of scope.
const SIGNIN_DIR = 'apps/studio/components/interfaces/SignIn';

// Toolchain versions the monorepo pins and our derived image build must match.
// These are NOT cosmetic: root package.json sets `packageManager`, and pnpm
// manages its own version by default, so a stale pin fails `pnpm install`
// outright. turbo drifted 2.9.3 vs 2.9.14 unnoticed for two months, which is
// why it is asserted rather than trusted.
const OUR_DOCKERFILE = 'infra/studio-platform/Dockerfile';
const UPSTREAM_DOCKERFILE = 'apps/studio/Dockerfile';

// Which dashboard_auth flag gates each auth screen. A screen whose flag patch 1
// disables is unreachable, so an unguarded widget there is latent, not live —
// it only bites if someone re-enables the flag. That is a WARN, not a FAIL.
const SCREEN_GATED_BY = {
  'SignInForm.tsx': null, // always reachable
  'ForgotPasswordWizard.tsx': null, // reachable from email sign-in
  'SignUpForm.tsx': 'dashboard_auth:sign_up',
  'SignInSSOForm.tsx': 'dashboard_auth:sign_in_with_sso',
};

// ---------------------------------------------------------------- cli + git

const argv = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}

const dir = positional[0] ?? process.env.SUPABASE_FORK_DIR;
if (!dir) {
  console.error(`usage: ${process.argv[1]} <checkout-dir> [--ref <ref>] [--base <ref>]`);
  process.exit(2);
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (allowFail) return null;
    console.error(`FATAL: git ${args.join(' ')} failed in ${dir}\n${err.stderr ?? err.message}`);
    process.exit(2);
  }
}

// Find a remote by repo slug (tolerates https/ssh and a .git suffix), same
// approach as sync-studio-fork.sh so both scripts accept either checkout layout.
function remoteFor(slug) {
  const out = git(['remote', '-v']);
  for (const line of out.split('\n')) {
    const [name, url, kind] = line.split(/\s+/);
    if (kind === '(fetch)' && url && new RegExp(`${slug.replace('/', '\\/')}(\\.git)?$`).test(url))
      return name;
  }
  return null;
}

function resolve(ref) {
  return git(['rev-parse', '--verify', '--quiet', ref], { allowFail: true })?.trim() || null;
}

function show(ref, path) {
  return git(['show', `${ref}:${path}`], { allowFail: true });
}

git(['rev-parse', '--is-inside-work-tree']);

const forkRemote = remoteFor(FORK_REPO);
const upstreamRemote = remoteFor(UPSTREAM_REPO);

const ref =
  opts.ref ??
  (forkRemote && resolve(`${forkRemote}/${PATCH_BRANCH}`)
    ? `${forkRemote}/${PATCH_BRANCH}`
    : PATCH_BRANCH);
const base =
  opts.base ??
  (upstreamRemote && resolve(`${upstreamRemote}/${MAIN_BRANCH}`)
    ? `${upstreamRemote}/${MAIN_BRANCH}`
    : `origin/${MAIN_BRANCH}`);

if (!resolve(ref)) {
  console.error(`FATAL: cannot resolve --ref '${ref}' in ${dir} (fetch the fork first?)`);
  process.exit(2);
}
if (!resolve(base)) {
  console.error(`FATAL: cannot resolve --base '${base}' in ${dir} (fetch upstream first?)`);
  process.exit(2);
}

// ---------------------------------------------------------------- assertions

const results = [];
const warnings = [];
const check =
  (name, detail) =>
  (pass, message, extra = []) =>
    results.push({ name, detail, pass, message, extra });

// 1 — file-set drift. Catches an undocumented patch appearing AND a patch
//     silently vanishing (a `git rebase --skip` drops a commit without a word).
{
  const c = check('patch file set', `${base}...${ref}`);
  const actual = git(['diff', '--name-only', `${base}...${ref}`])
    .split('\n')
    .filter(Boolean)
    .sort();
  const expected = [...EXPECTED_PATCH_FILES].sort();
  const unexpected = actual.filter((f) => !expected.includes(f));
  const missing = expected.filter((f) => !actual.includes(f));

  if (unexpected.length || missing.length) {
    c(false, `${actual.length} file(s) differ from upstream, expected ${expected.length}`, [
      ...unexpected.map((f) => `undocumented patch file: ${f}`),
      ...missing.map((f) => `expected patch file no longer differs (dropped?): ${f}`),
    ]);
  } else {
    c(true, `${actual.length} file(s), exactly the documented set`);
  }
}

// 2 — closed-world dashboard_auth assertion. This is the check that catches a
//     flag upstream invents after the patch was written.
let resolvedFlags = null;
{
  const c = check('dashboard_auth flags', FLAGS_FILE);
  const raw = show(ref, FLAGS_FILE);
  if (raw === null) {
    c(false, `${FLAGS_FILE} does not exist at ${ref} — upstream moved or removed it`);
  } else {
    let flags;
    try {
      flags = JSON.parse(raw);
    } catch (err) {
      c(false, `${FLAGS_FILE} is not valid JSON at ${ref}: ${err.message}`);
      flags = null;
    }
    if (flags) {
      resolvedFlags = flags;
      const inNamespace = Object.entries(flags).filter(([k]) => k.startsWith(FLAG_NAMESPACE));
      const offenders = inNamespace.filter(([k, v]) => !FLAGS_ALLOWED_TRUE.has(k) && v !== false);
      const missingAllowed = [...FLAGS_ALLOWED_TRUE].filter((k) => !(k in flags));

      if (!inNamespace.length) {
        c(false, `no ${FLAG_NAMESPACE}* keys found — upstream renamed the namespace`);
      } else if (offenders.length || missingAllowed.length) {
        c(false, `${offenders.length} flag(s) not disabled`, [
          ...offenders.map(([k, v]) => `${k} = ${v} (expected false; new upstream flag?)`),
          ...missingAllowed.map((k) => `expected-true flag is gone from upstream: ${k}`),
        ]);
      } else {
        c(
          true,
          `${inNamespace.length} flag(s) in namespace, all disabled except sign_in_with_email`,
        );
      }
    }
  }
}

// 3 — hCaptcha renders only behind a site-key guard. Upstream's own form is
//     `sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY!}` — the non-null
//     assertion assumes Cloud always bakes a key. Our image bakes none, and an
//     unguarded widget initializes with undefined and BLOCKS sign-in.
{
  const c = check('hCaptcha guard', SIGNIN_DIR);
  const problems = [];
  let guarded = 0;

  // Every file in the sign-in surface, not a hardcoded pair — a new auth screen
  // added upstream has to be judged too.
  const listing =
    git(['ls-tree', '--name-only', '-r', ref, '--', SIGNIN_DIR], { allowFail: true }) ?? '';
  const screens = listing.split('\n').filter((f) => f.endsWith('.tsx'));

  if (!screens.length) {
    problems.push(
      `${SIGNIN_DIR} has no .tsx files at ${ref} — upstream restructured the sign-in surface`,
    );
  }

  for (const file of screens) {
    const src = show(ref, file);
    if (src === null) continue;

    // `useRef<HCaptcha>(null)` is a type parameter, not a render. Drop those
    // before counting, or every file reads as one widget short of its guards.
    const jsx = src.replace(/useRef<HCaptcha>/g, '');
    const renders = (jsx.match(/<HCaptcha[\s/>]/g) ?? []).length;
    if (!renders) continue;

    const guards = (jsx.match(/NEXT_PUBLIC_HCAPTCHA_SITE_KEY\s*&&/g) ?? []).length;
    const asserts = (jsx.match(/NEXT_PUBLIC_HCAPTCHA_SITE_KEY!/g) ?? []).length;
    if (renders <= guards && asserts === 0) {
      guarded += renders;
      continue;
    }

    const name = file.slice(file.lastIndexOf('/') + 1);
    const gate = name in SCREEN_GATED_BY ? SCREEN_GATED_BY[name] : undefined;
    const detail =
      asserts > 0
        ? `${asserts} unguarded NEXT_PUBLIC_HCAPTCHA_SITE_KEY! assertion(s)`
        : `${renders} <HCaptcha> render(s) but only ${guards} guard(s)`;

    if (gate === undefined) {
      // An auth screen this script has never seen — cannot prove it is gated off.
      problems.push(`${name}: ${detail} (unknown screen — add it to SCREEN_GATED_BY)`);
    } else if (gate === null) {
      problems.push(`${name}: ${detail}`);
    } else if (resolvedFlags && resolvedFlags[gate] === false) {
      warnings.push(`${name}: ${detail} — latent only, gated off by ${gate}=false`);
    } else {
      problems.push(`${name}: ${detail} — reachable, ${gate} is not disabled`);
    }
  }

  if (problems.length) c(false, `${problems.length} problem(s) on the sign-in surface`, problems);
  else c(true, `${guarded} reachable widget(s), every one behind a site-key guard`);
}

// 4 — image toolchain pins. Our Dockerfile is DERIVED from upstream's, not
//     generated from it, so nothing but this makes the two agree.
{
  const c = check('image toolchain pins', OUR_DOCKERFILE);
  const ours = (() => {
    try {
      return readFileSync(resolvePath(process.cwd(), OUR_DOCKERFILE), 'utf8');
    } catch {
      return null;
    }
  })();
  const theirs = show(ref, UPSTREAM_DOCKERFILE);
  const pkg = show(ref, 'package.json');

  if (ours === null) {
    c(false, `${OUR_DOCKERFILE} not readable from ${process.cwd()} — run from the supastack repo root`);
  } else if (theirs === null) {
    c(false, `${UPSTREAM_DOCKERFILE} does not exist at ${ref} — upstream moved the image build`);
  } else {
    const pin = (src, re) => src.match(re)?.[1] ?? null;
    const wanted = {
      pnpm: pin(pkg ?? '', /"packageManager"\s*:\s*"pnpm@([0-9][^"]*)"/) ?? pin(theirs, /pnpm@([0-9][^\s"']*)/),
      turbo: pin(theirs, /turbo@([0-9][^\s"']*)/),
    };
    const got = {
      pnpm: pin(ours, /npm install -g pnpm@([0-9][^\s"']*)/),
      turbo: pin(ours, /turbo@([0-9][^\s"']*)/),
    };
    const drift = Object.entries(wanted)
      .filter(([k, v]) => v && got[k] !== v)
      .map(([k, v]) => `${k}: ours ${got[k] ?? '(none)'} vs upstream ${v}`);
    if (drift.length) c(false, `${drift.length} pin(s) drifted from upstream`, drift);
    else c(true, `pnpm ${got.pnpm} + turbo ${got.turbo}, both matching upstream`);
  }
}

// ---------------------------------------------------------------- report

const pad = Math.max(...results.map((r) => r.name.length));
console.log(`\nstudio patch assertions — ref ${ref}  vs base ${base}\n`);
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(pad)}  ${r.message}`);
  for (const line of r.extra) console.log(`        ${line}`);
}

for (const w of warnings) console.log(`  WARN  ${''.padEnd(pad)}  ${w}`);

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} assertions passed` +
    (warnings.length ? `, ${warnings.length} warning(s)` : '') +
    '\n',
);
process.exit(failed.length ? 1 : 0);

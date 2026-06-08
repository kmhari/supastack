// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { QUEUES } from '@supastack/shared';

/**
 * Producer/consumer queue-name contract (feature 086).
 *
 * The bug: the api enqueued BullMQ jobs to `selfbase.<x>` while the worker
 * consumed `supastack.<x>` (a half-done rename), so restore/lifecycle/backup/
 * pg-edge-cert/pooler/vault jobs were enqueued to queues nobody consumed and
 * silently dropped. A live restore exposed it. The structural fix is a single
 * shared `QUEUES` constant (packages/shared/src/queues.ts) that BOTH sides
 * reference; these tests fail CI if anyone reintroduces the drift.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '../../../..'); // apps/api/tests/contract → repo root
const SRC_DIRS = [join(REPO, 'apps/api/src'), join(REPO, 'apps/worker/src')];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = SRC_DIRS.flatMap(tsFiles);
const rel = (p: string): string => relative(REPO, p);
// First argument of every `new Queue(...)` / `new Worker(...)` (handles newlines).
const CTOR_RE = /new\s+(?:Queue|Worker)\s*\(\s*([^\s,)]+)/g;

describe('BullMQ queue-name contract (feature 086 — producer/consumer drift)', () => {
  it('names every queue via QUEUES.<key> — no string literals, no ad-hoc variables', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = CTOR_RE.exec(src))) {
        if (!m[1]!.startsWith('QUEUES.')) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${rel(f)}:${line} → new Queue/Worker(${m[1]})`);
        }
      }
    }
    expect(
      offenders,
      `Queue/Worker names MUST come from QUEUES (@supastack/shared), never a literal ` +
        `or local var (that is how 'selfbase.*' vs 'supastack.*' drifted):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every canonical QUEUES queue has a consuming Worker (a producer can never target a dead queue)', () => {
    const consumed = new Set<string>();
    const re = /new\s+Worker\s*\(\s*QUEUES\.([A-Za-z0-9_]+)/g;
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) consumed.add(m[1]!);
    }
    const orphans = Object.keys(QUEUES).filter((k) => !consumed.has(k));
    expect(orphans, `QUEUES keys with no consuming new Worker(): ${orphans.join(', ')}`).toEqual([]);
  });

  it('regression: restore + the 5 once-broken producers enqueue via QUEUES, not selfbase.*', () => {
    expect(QUEUES.restore).toBe('supastack.restore');
    const expectations: Array<[string, string]> = [
      ['apps/api/src/services/backups-mgmt-service.ts', 'QUEUES.restore'],
      ['apps/api/src/routes/management/backups-mgmt.ts', 'QUEUES.restore'],
      ['apps/api/src/routes/management/pause-restore.ts', 'QUEUES.lifecycle'],
      ['apps/api/src/routes/backups.ts', 'QUEUES.backup'],
      ['apps/api/src/services/cert-check.ts', 'QUEUES.pgEdgeCertIssue'],
      ['apps/api/src/services/pooler-reconciler-client.ts', 'QUEUES.poolerReconciler'],
      ['apps/api/src/services/vault-enable-client.ts', 'QUEUES.vaultEnable'],
    ];
    for (const [file, ref] of expectations) {
      const src = readFileSync(join(REPO, file), 'utf8');
      expect(src, `${file} should reference ${ref}`).toContain(ref);
      expect(src, `${file} must not hardcode a selfbase.* queue name`).not.toMatch(
        /new\s+Queue\(\s*['"`]selfbase\./,
      );
    }
  });
});

/**
 * Fixture set for the 7 pooler drift classes — T041.
 *
 * Each fixture pairs a declared/observed state with the expected
 * classification produced by `classifyInstance` in
 * `apps/worker/src/services/pooler-reconciler.ts`.
 *
 * Classes (per docs/pooler-resilience.md + data-model.md):
 *   1. consistent
 *   2. missing_pooler_row
 *   3. missing_in_supavisor
 *   4. failed_stale
 *   5. instance_gone
 *   6. orphan_in_supavisor
 *   7. pg_password_drift
 */

export interface Inst {
  ref: string;
  status: string;
}
export interface PoolerRow {
  ref: string;
  externalId: string;
  status: string;
  updatedAt: Date;
}
export interface SvTenant {
  external_id: string;
}

export interface DriftFixture {
  id: string;
  declared: { inst: Inst; poolerRow?: PoolerRow; svTenant?: SvTenant };
  observed: string;
  expected:
    | 'consistent'
    | 'missing_pooler_row'
    | 'failed_stale'
    | 'missing_in_supavisor'
    | 'instance_gone'
    | 'orphan_in_supavisor'
    | 'pg_password_drift';
  expectedRemediation:
    | 'noop'
    | 'register'
    | 'retry_register'
    | 'unregister'
    | 'unregister_orphan'
    | 'reset_then_register';
}

const ref = 'r0000000000000000001';
const orphanRef = 'r9999999999999999999';
const fresh = new Date(Date.now() - 5 * 60 * 1000); // 5 min old
const stale = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h old

export const driftFixtures: DriftFixture[] = [
  {
    id: 'consistent',
    declared: {
      inst: { ref, status: 'running' },
      poolerRow: { ref, externalId: ref, status: 'active', updatedAt: fresh },
      svTenant: { external_id: ref },
    },
    observed: 'all three sources agree',
    expected: 'consistent',
    expectedRemediation: 'noop',
  },
  {
    id: 'missing_pooler_row',
    declared: { inst: { ref, status: 'running' } },
    observed: 'instance exists, no pooler_tenants row, no supavisor entry',
    expected: 'missing_pooler_row',
    expectedRemediation: 'register',
  },
  {
    id: 'missing_in_supavisor',
    declared: {
      inst: { ref, status: 'running' },
      poolerRow: { ref, externalId: ref, status: 'active', updatedAt: fresh },
    },
    observed: 'pooler row marks active but supavisor lost it',
    expected: 'missing_in_supavisor',
    expectedRemediation: 'register',
  },
  {
    id: 'failed_stale',
    declared: {
      inst: { ref, status: 'running' },
      poolerRow: { ref, externalId: ref, status: 'failed', updatedAt: stale },
    },
    observed: 'pooler row failed >1h ago',
    expected: 'failed_stale',
    expectedRemediation: 'retry_register',
  },
  {
    id: 'instance_gone',
    declared: {
      inst: { ref, status: 'deleting' },
      poolerRow: { ref, externalId: ref, status: 'active', updatedAt: fresh },
      svTenant: { external_id: ref },
    },
    observed: 'instance flagged deleting',
    expected: 'instance_gone',
    expectedRemediation: 'unregister',
  },
  {
    id: 'orphan_in_supavisor',
    declared: {
      inst: { ref: orphanRef, status: 'running' },
      poolerRow: { ref: orphanRef, externalId: orphanRef, status: 'active', updatedAt: fresh },
      svTenant: { external_id: orphanRef },
    },
    observed:
      'supavisor has a tenant with no matching instance row (stale pooler row points to a removed instance)',
    expected: 'orphan_in_supavisor',
    expectedRemediation: 'unregister_orphan',
  },
  {
    id: 'pg_password_drift',
    declared: {
      inst: { ref, status: 'running' },
      poolerRow: { ref, externalId: ref, status: 'pg_password_drift', updatedAt: fresh },
    },
    observed: 'pooler row pre-flagged with drift after probe',
    expected: 'pg_password_drift',
    expectedRemediation: 'reset_then_register',
  },
];

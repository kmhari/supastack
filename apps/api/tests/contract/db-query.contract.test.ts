/**
 * T007 — wire-shape contract test for POST /v1/projects/:ref/database/query.
 *
 * Pinned against the upstream Supabase Management API spec. Snapshot refresh:
 *   curl -s https://api.supabase.com/api/v1-json \
 *     | jq '.components.schemas.V1RunQueryBody' \
 *     > apps/api/tests/contract/__snapshots__/v1-run-query-body.json
 *
 * If this test breaks after upstream changes the wire shape, re-run the
 * snapshot command, review the diff (in PR), and update the Zod schema in
 * packages/shared/src/mgmt-api-schemas.ts if a real change has landed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DbQueryBodySchema, DbQueryResponseSchema } from '@selfbase/shared';

const SNAPSHOT_PATH = resolve(__dirname, '__snapshots__', 'v1-run-query-body.json');

interface UpstreamSchema {
  type: 'object';
  required: string[];
  properties: Record<string, { type?: string; minLength?: number; items?: unknown }>;
}

const upstream: UpstreamSchema = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

describe('V1RunQueryBody wire compatibility', () => {
  it('snapshot has not silently drifted', () => {
    expect(upstream.type).toBe('object');
    expect(upstream.required).toEqual(['query']);
    expect(Object.keys(upstream.properties).sort()).toEqual(['parameters', 'query', 'read_only']);
    expect(upstream.properties.query?.type).toBe('string');
    expect(upstream.properties.query?.minLength).toBe(1);
    expect(upstream.properties.parameters?.type).toBe('array');
    expect(upstream.properties.read_only?.type).toBe('boolean');
  });

  it('Zod schema accepts upstream example verbatim', () => {
    const example = { query: 'select * from pg_stat_activity limit 1;', read_only: true };
    expect(DbQueryBodySchema.safeParse(example).success).toBe(true);
  });

  it('Zod schema accepts the minimal upstream-required shape', () => {
    expect(DbQueryBodySchema.safeParse({ query: 'SELECT 1' }).success).toBe(true);
  });

  it('Zod schema accepts parameterized + read_only together', () => {
    expect(
      DbQueryBodySchema.safeParse({
        query: 'SELECT $1::int',
        parameters: [42],
        read_only: true,
      }).success,
    ).toBe(true);
  });

  it('Zod schema rejects empty query (minLength: 1)', () => {
    expect(DbQueryBodySchema.safeParse({ query: '' }).success).toBe(false);
  });

  it('Zod schema rejects missing query (required)', () => {
    expect(DbQueryBodySchema.safeParse({ parameters: [1] }).success).toBe(false);
  });

  it('Zod response schema accepts the bare-array success shape', () => {
    // Upstream returns a bare array (NOT { result: [...] }). The upstream MCP
    // server's `list_tables` tool calls `.map()` directly on the response.
    expect(DbQueryResponseSchema.safeParse([{ id: 'abc', email: 'a@b.c' }]).success).toBe(true);
    expect(DbQueryResponseSchema.safeParse([]).success).toBe(true);
    // Envelope shape MUST be rejected.
    expect(DbQueryResponseSchema.safeParse({ result: [{ id: 'abc' }] }).success).toBe(false);
  });
});

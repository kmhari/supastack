import { describe, expect, it } from 'vitest';
import {
  UpdatePostgresConfigBodySchema,
  POSTGRES_INTEGER_FIELDS,
  POSTGRES_BOOLEAN_FIELDS,
  POSTGRES_CONFIG_PARAM_NAMES,
} from '@selfbase/shared';

/**
 * Unit tests for the postgres-config surface (feature 026).
 *
 * Covers:
 * - Zod schema validation (valid body, unknown fields, bad ranges)
 * - POSTGRES_INTEGER_FIELDS / POSTGRES_BOOLEAN_FIELDS membership
 * - POSTGRES_CONFIG_PARAM_NAMES completeness
 * - restart_database is stripped from param names
 */

describe('UpdatePostgresConfigBodySchema', () => {
  it('accepts a minimal valid body', () => {
    const result = UpdatePostgresConfigBodySchema.parse({ max_connections: 100 });
    expect(result.max_connections).toBe(100);
  });

  it('accepts all string memory fields', () => {
    const body = {
      shared_buffers: '256MB',
      work_mem: '4MB',
      effective_cache_size: '1GB',
      maintenance_work_mem: '64MB',
    };
    expect(() => UpdatePostgresConfigBodySchema.parse(body)).not.toThrow();
  });

  it('accepts time-unit strings for statement_timeout', () => {
    expect(() =>
      UpdatePostgresConfigBodySchema.parse({ statement_timeout: '8000ms' }),
    ).not.toThrow();
    expect(() => UpdatePostgresConfigBodySchema.parse({ statement_timeout: '30s' })).not.toThrow();
    expect(() => UpdatePostgresConfigBodySchema.parse({ statement_timeout: '5min' })).not.toThrow();
  });

  it('rejects statement_timeout with invalid unit', () => {
    const result = UpdatePostgresConfigBodySchema.safeParse({ statement_timeout: '30 seconds' });
    expect(result.success).toBe(false);
  });

  it('rejects max_connections below minimum (1)', () => {
    const result = UpdatePostgresConfigBodySchema.safeParse({ max_connections: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects max_connections above maximum (262143)', () => {
    const result = UpdatePostgresConfigBodySchema.safeParse({ max_connections: 999999 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict schema)', () => {
    const result = UpdatePostgresConfigBodySchema.safeParse({ unknown_param: 'val' });
    expect(result.success).toBe(false);
  });

  it('accepts restart_database boolean', () => {
    const result = UpdatePostgresConfigBodySchema.parse({ restart_database: true });
    expect(result.restart_database).toBe(true);
  });

  it('accepts session_replication_role enum values', () => {
    for (const v of ['origin', 'replica', 'local']) {
      expect(() =>
        UpdatePostgresConfigBodySchema.parse({ session_replication_role: v }),
      ).not.toThrow();
    }
  });

  it('rejects invalid session_replication_role', () => {
    const result = UpdatePostgresConfigBodySchema.safeParse({
      session_replication_role: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts boolean fields', () => {
    const result = UpdatePostgresConfigBodySchema.parse({
      track_commit_timestamp: true,
      hot_standby_feedback: false,
    });
    expect(result.track_commit_timestamp).toBe(true);
    expect(result.hot_standby_feedback).toBe(false);
  });
});

describe('POSTGRES_INTEGER_FIELDS', () => {
  it('includes max_connections', () => {
    expect(POSTGRES_INTEGER_FIELDS.has('max_connections')).toBe(true);
  });

  it('does not include string-typed fields', () => {
    expect(POSTGRES_INTEGER_FIELDS.has('shared_buffers')).toBe(false);
    expect(POSTGRES_INTEGER_FIELDS.has('work_mem')).toBe(false);
    expect(POSTGRES_INTEGER_FIELDS.has('statement_timeout')).toBe(false);
  });
});

describe('POSTGRES_BOOLEAN_FIELDS', () => {
  it('includes track_commit_timestamp and hot_standby_feedback', () => {
    expect(POSTGRES_BOOLEAN_FIELDS.has('track_commit_timestamp')).toBe(true);
    expect(POSTGRES_BOOLEAN_FIELDS.has('hot_standby_feedback')).toBe(true);
  });

  it('does not include integer fields', () => {
    expect(POSTGRES_BOOLEAN_FIELDS.has('max_connections')).toBe(false);
  });
});

describe('POSTGRES_CONFIG_PARAM_NAMES', () => {
  it('does not include restart_database (not a pg parameter)', () => {
    expect(POSTGRES_CONFIG_PARAM_NAMES).not.toContain('restart_database');
  });

  it('includes the 25 expected parameters', () => {
    expect(POSTGRES_CONFIG_PARAM_NAMES).toHaveLength(25);
  });

  it('all param names are lowercase with underscores only', () => {
    for (const name of POSTGRES_CONFIG_PARAM_NAMES) {
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });

  it('no duplicates', () => {
    expect(new Set(POSTGRES_CONFIG_PARAM_NAMES).size).toBe(POSTGRES_CONFIG_PARAM_NAMES.length);
  });
});

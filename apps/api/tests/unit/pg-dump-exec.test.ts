import { describe, expect, it } from 'vitest';
import { buildPgDumpArgs } from '../../src/services/pg-dump-exec.js';

/**
 * T006 — pure tests for the pg_dump argv composition. The Docker-socket
 * exec + streaming path is exercised by the live-VM E2E (T020), since
 * mocking node:http + the demux protocol adds more harness than signal.
 */
describe('buildPgDumpArgs', () => {
  it('emits sensible defaults', () => {
    const args = buildPgDumpArgs({});
    expect(args[0]).toBe('pg_dump');
    expect(args).toContain('-h');
    expect(args).toContain('127.0.0.1');
    expect(args).toContain('-U');
    expect(args).toContain('postgres');
    expect(args).toContain('-d');
    expect(args).toContain('postgres');
    expect(args).toContain('--no-owner');
    expect(args).toContain('--no-privileges');
  });

  it('appends --data-only when dataOnly:true', () => {
    expect(buildPgDumpArgs({ dataOnly: true })).toContain('--data-only');
  });

  it('appends --schema-only when schemaOnly:true', () => {
    expect(buildPgDumpArgs({ schemaOnly: true })).toContain('--schema-only');
  });

  it('appends --schema=<name> in order for each schema', () => {
    const args = buildPgDumpArgs({ schemas: ['public', 'auth', 'storage'] });
    const schemaIdxs = args
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.startsWith('--schema='))
      .map(({ a }) => a);
    expect(schemaIdxs).toEqual(['--schema=public', '--schema=auth', '--schema=storage']);
  });

  it('combines all flags coherently', () => {
    const args = buildPgDumpArgs({
      dataOnly: true,
      schemas: ['public', 'storage'],
    });
    expect(args).toContain('--data-only');
    expect(args).toContain('--schema=public');
    expect(args).toContain('--schema=storage');
    expect(args).not.toContain('--schema-only');
  });
});

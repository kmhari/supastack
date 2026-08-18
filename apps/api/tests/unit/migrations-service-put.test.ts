/**
 * Service-level tests for `putMigration` — upstream's v1-upsert-a-migration.
 *
 * The route tests mock this module out, so the two decisions that actually live
 * here are untested from there: deriving the version stamp, and what happens
 * when two writes land in the same UTC second or under the same
 * Idempotency-Key. Those are exercised against a fake pg client that behaves
 * like the real table's constraints (version primary key, unique
 * idempotency_key) rather than against a mock that always says yes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = {
  version: string;
  name: string | null;
  statements: string[] | null;
  rollback: string[] | null;
  created_by: string | null;
  idempotency_key: string | null;
};

const table: Row[] = [];
/** SQLSTATE 23505 — what pg raises for either unique constraint here. */
class UniqueViolation extends Error {
  code = '23505';
}
let failIdempotencyRace = false;
/** Raise 23505 on the next insert regardless of key — stands in for a unique
 *  constraint we do NOT know how to recover from. */
let failUnrecoverably = false;

const fakeClient = {
  query: vi.fn(async (sql: string, params?: any[]) => {
    if (sql.includes('CREATE SCHEMA')) return { rows: [], rowCount: 0 };
    if (sql.trimStart().startsWith('SELECT')) {
      const key = params![0] as string;
      return { rows: table.filter((r) => r.idempotency_key === key), rowCount: 0 };
    }
    if (sql.trimStart().startsWith('INSERT')) {
      const [version, name, statements, rollback, created_by, idempotency_key] = params as [
        string,
        string | null,
        string[],
        string[] | null,
        string | null,
        string | null,
      ];
      if (failUnrecoverably) {
        failUnrecoverably = false;
        throw new UniqueViolation('duplicate key value violates unique constraint');
      }
      if (failIdempotencyRace && idempotency_key) {
        // Simulate another request winning between our SELECT and this INSERT.
        failIdempotencyRace = false;
        table.push({
          version: 'raced',
          name,
          statements,
          rollback,
          created_by: 'someone-else',
          idempotency_key,
        });
        throw new UniqueViolation('duplicate key value violates unique constraint');
      }
      // ON CONFLICT (version) DO NOTHING
      if (table.some((r) => r.version === version)) return { rows: [], rowCount: 0 };
      const row: Row = { version, name, statements, rollback, created_by, idempotency_key };
      table.push(row);
      return { rows: [row], rowCount: 1 };
    }
    throw new Error(`unexpected sql: ${sql}`);
  }),
};

vi.mock('../../src/services/per-instance-pg.js', () => ({
  withPerInstancePg: async (_ref: string, cb: (c: unknown) => unknown) => cb(fakeClient),
  InstanceNotFoundError: class extends Error {},
  InstanceNotRunningError: class extends Error {},
  PerInstancePgConnectError: class extends Error {},
}));

const { putMigration, versionFromDate, MigrationVersionCollisionError } =
  await import('../../src/services/migrations-service.js');

const REF = 'abcdefghijklmnopqrst';
const QUERY = 'create table public.widgets(id bigint primary key);';

beforeEach(() => {
  table.length = 0;
  failIdempotencyRace = false;
  failUnrecoverably = false;
  fakeClient.query.mockClear();
});

describe('versionFromDate', () => {
  it('happy: renders UTC as the 14-digit stamp the rest of the API validates', () => {
    expect(versionFromDate(new Date('2026-08-18T12:34:56.789Z'))).toBe('20260818123456');
  });

  it('happy: pads every field, so a single-digit month is not an 13-char version', () => {
    expect(versionFromDate(new Date('2026-01-02T03:04:05Z'))).toBe('20260102030405');
  });

  it('happy: reads UTC, not local time', () => {
    // 23:30 UTC is the NEXT day in +05:30, where this repo is developed. A
    // local-time stamp here would produce a version a day ahead of the row it
    // describes and sort wrongly against CLI-generated versions.
    expect(versionFromDate(new Date('2026-08-18T23:30:00Z'))).toBe('20260818233000');
  });
});

describe('putMigration', () => {
  it('happy: stores the query as a single-element statements[] and does NOT execute it', async () => {
    const row = await putMigration(REF, {
      query: QUERY,
      name: 'create_widgets',
      rollback: 'drop table if exists public.widgets;',
      createdBy: 'op@x.dev',
      now: new Date('2026-08-18T12:00:00Z'),
    });

    expect(row).toMatchObject({
      version: '20260818120000',
      name: 'create_widgets',
      statements: [QUERY],
      rollback: ['drop table if exists public.widgets;'],
      created_by: 'op@x.dev',
    });
    // Nothing but bootstrap + insert ran — the migration body is recorded, never
    // applied ("upsert a database migration without applying").
    const executed = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(executed.some((sql) => sql.includes('create table public.widgets'))).toBe(false);
  });

  it('happy: two writes in the same UTC second get distinct versions, one second apart', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const first = await putMigration(REF, { query: QUERY, now });
    const second = await putMigration(REF, { query: 'select 2;', now });

    expect(first.version).toBe('20260818120000');
    expect(second.version).toBe('20260818120001');
  });

  it('happy: a repeat with the same Idempotency-Key returns the original row, no second stamp', async () => {
    const first = await putMigration(REF, {
      query: QUERY,
      idempotencyKey: 'key-1',
      now: new Date('2026-08-18T12:00:00Z'),
    });
    const again = await putMigration(REF, {
      query: 'a completely different query;',
      idempotencyKey: 'key-1',
      now: new Date('2026-08-18T13:00:00Z'),
    });

    expect(again.version).toBe(first.version);
    expect(again.statements).toEqual([QUERY]); // the FIRST body, not the retry's
    expect(table).toHaveLength(1);
  });

  it('happy: losing the Idempotency-Key race returns the winner rather than erroring', async () => {
    failIdempotencyRace = true;
    const row = await putMigration(REF, {
      query: QUERY,
      idempotencyKey: 'key-1',
      now: new Date('2026-08-18T12:00:00Z'),
    });

    expect(row.version).toBe('raced');
    expect(row.created_by).toBe('someone-else');
  });

  it('sad: a 23505 with no Idempotency-Key propagates — only the key race is recoverable', async () => {
    failUnrecoverably = true;
    await expect(
      putMigration(REF, { query: QUERY, now: new Date('2026-08-18T12:00:00Z') }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(table).toHaveLength(0);
  });

  it('sad: a 23505 WITH a key that finds no winner still propagates, not a silent success', async () => {
    // The recovery path only returns a row when one is actually there. If the
    // lookup comes back empty the original error must survive, or the caller is
    // told a migration was recorded when none was.
    failUnrecoverably = true;
    await expect(
      putMigration(REF, {
        query: QUERY,
        idempotencyKey: 'key-1',
        now: new Date('2026-08-18T12:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('sad: a wall of occupied versions gives up with a typed error, not an infinite loop', async () => {
    const now = new Date('2026-08-18T12:00:00Z');
    for (let i = 0; i < 6; i++) {
      table.push({
        version: versionFromDate(new Date(now.getTime() + i * 1000)),
        name: null,
        statements: null,
        rollback: null,
        created_by: null,
        idempotency_key: null,
      });
    }

    await expect(putMigration(REF, { query: QUERY, now })).rejects.toBeInstanceOf(
      MigrationVersionCollisionError,
    );
  });

  it('sad: an absent rollback stays null rather than an array holding a blank', async () => {
    const row = await putMigration(REF, { query: QUERY, now: new Date('2026-08-18T12:00:00Z') });
    expect(row.rollback).toBeNull();
    expect(row.idempotency_key).toBeNull();
  });
});

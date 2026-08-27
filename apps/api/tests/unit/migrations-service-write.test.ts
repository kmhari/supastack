/**
 * Service-level tests for the two collection writers — `putMigration`
 * (v1-upsert-a-migration, record only) and `applyMigration`
 * (v1-apply-a-migration, execute AND record).
 *
 * The route tests mock this module out, so the decisions that actually live
 * here are untested from there: deriving the version stamp, what happens when
 * two writes land in the same UTC second or under the same Idempotency-Key,
 * and whether a failed migration can leave a history row behind claiming it
 * worked. The fake client below enforces the real table's constraints (version
 * primary key, unique idempotency_key) and real transaction semantics
 * (ROLLBACK restores the pre-BEGIN rows), rather than being a mock that always
 * says yes.
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

/** Every statement the service issued, in order — the only way to assert that
 *  the history row is written inside the transaction and before the migration
 *  runs, and that a repeat under a known key runs neither. */
const executed: string[] = [];
/** Non-null while a transaction is open: the rows to restore on ROLLBACK. */
let snapshot: Row[] | null = null;
/** SQL fragment whose execution should fail, standing in for a bad migration. */
let failingSql: string | null = null;

const fakeClient = {
  query: vi.fn(async (sql: string, params?: any[]) => {
    executed.push(sql);

    if (sql === 'BEGIN') {
      snapshot = [...table];
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'COMMIT') {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'ROLLBACK') {
      if (snapshot) table.splice(0, table.length, ...snapshot);
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('CREATE SCHEMA')) return { rows: [], rowCount: 0 };
    if (sql.trimStart().startsWith('SELECT')) {
      const key = params![0] as string;
      return { rows: table.filter((r) => r.idempotency_key === key), rowCount: 0 };
    }
    if (sql.trimStart().startsWith('INSERT INTO supabase_migrations')) {
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
        // The winner committed on a DIFFERENT connection, so it must survive our
        // ROLLBACK — hence it goes into the snapshot as well as the table.
        failIdempotencyRace = false;
        const winner: Row = {
          version: 'raced',
          name,
          statements,
          rollback,
          created_by: 'someone-else',
          idempotency_key,
        };
        table.push(winner);
        if (snapshot) snapshot.push(winner);
        throw new UniqueViolation('duplicate key value violates unique constraint');
      }
      // ON CONFLICT (version) DO NOTHING
      if (table.some((r) => r.version === version)) return { rows: [], rowCount: 0 };
      const row: Row = { version, name, statements, rollback, created_by, idempotency_key };
      table.push(row);
      return { rows: [row], rowCount: 1 };
    }
    // Anything else is the operator's own migration SQL.
    if (failingSql && sql.includes(failingSql)) {
      throw Object.assign(new Error('syntax error at or near "creat"'), { code: '42601' });
    }
    return { rows: [], rowCount: 0 };
  }),
};

vi.mock('../../src/services/per-instance-pg.js', () => ({
  withPerInstancePg: async (_ref: string, cb: (c: unknown) => unknown) => cb(fakeClient),
  InstanceNotFoundError: class extends Error {},
  InstanceNotRunningError: class extends Error {},
  PerInstancePgConnectError: class extends Error {},
}));

const { applyMigration, putMigration, versionFromDate, MigrationVersionCollisionError } =
  await import('../../src/services/migrations-service.js');

const REF = 'abcdefghijklmnopqrst';
const QUERY = 'create table public.widgets(id bigint primary key);';

beforeEach(() => {
  table.length = 0;
  executed.length = 0;
  snapshot = null;
  failingSql = null;
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

describe('applyMigration', () => {
  const NOW = new Date('2026-08-18T12:00:00Z');
  const DDL = 'create table public.widgets(id bigint primary key);';

  it('happy: runs inside one transaction, history row first, then the migration', async () => {
    const row = await applyMigration(REF, { query: DDL, name: 'create_widgets', now: NOW });

    expect(row.version).toBe('20260818120000');
    const begin = executed.indexOf('BEGIN');
    const insert = executed.findIndex((s) => s.startsWith('INSERT INTO supabase_migrations'));
    const ddl = executed.indexOf(DDL);
    const commit = executed.indexOf('COMMIT');
    // Order matters: reserving the version before running the DDL is what lets a
    // version collision retry without executing the migration twice.
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(insert);
    expect(insert).toBeLessThan(ddl);
    expect(ddl).toBeLessThan(commit);
  });

  it('happy: the migration SQL is sent unparameterised, so multi-statement bodies work', async () => {
    const multi = 'create table a(id int);\ncreate table b(id int);';
    await applyMigration(REF, { query: multi, now: NOW });

    const call = fakeClient.query.mock.calls.find(([sql]) => sql === multi);
    expect(call).toBeDefined();
    // A params array would switch node-postgres to the extended protocol, which
    // permits only ONE statement per message.
    expect(call![1]).toBeUndefined();
  });

  it('happy: a repeat under a known Idempotency-Key re-executes NOTHING', async () => {
    await applyMigration(REF, { query: DDL, idempotencyKey: 'key-1', now: NOW });
    executed.length = 0;

    const again = await applyMigration(REF, {
      query: DDL,
      idempotencyKey: 'key-1',
      now: new Date('2026-08-18T13:00:00Z'),
    });

    expect(again.version).toBe('20260818120000');
    // This is the whole point of the header when the tracked thing has side
    // effects: no BEGIN, no DDL, no second row.
    expect(executed).not.toContain('BEGIN');
    expect(executed).not.toContain(DDL);
    expect(table).toHaveLength(1);
  });

  it('sad: a failing migration rolls back — no row survives claiming it applied', async () => {
    failingSql = 'creat table';

    await expect(
      applyMigration(REF, { query: 'creat table oops();', now: NOW }),
    ).rejects.toMatchObject({ code: '42601' });

    expect(executed).toContain('ROLLBACK');
    expect(executed).not.toContain('COMMIT');
    expect(table).toEqual([]);
  });

  it('sad: the SQL error propagates unchanged — the route needs its SQLSTATE', async () => {
    failingSql = 'boom';
    await expect(applyMigration(REF, { query: 'boom;', now: NOW })).rejects.toThrow(/syntax error/);
  });

  it('sad: version collision fails before anything executes', async () => {
    for (let i = 0; i < 6; i++) {
      table.push({
        version: versionFromDate(new Date(NOW.getTime() + i * 1000)),
        name: null,
        statements: null,
        rollback: null,
        created_by: null,
        idempotency_key: null,
      });
    }

    await expect(applyMigration(REF, { query: DDL, now: NOW })).rejects.toBeInstanceOf(
      MigrationVersionCollisionError,
    );
    expect(executed).not.toContain(DDL);
    expect(executed).toContain('ROLLBACK');
  });

  it('sad: losing the Idempotency-Key race returns the winner without re-running the DDL', async () => {
    failIdempotencyRace = true;

    const row = await applyMigration(REF, { query: DDL, idempotencyKey: 'key-1', now: NOW });

    expect(row.created_by).toBe('someone-else');
    expect(executed).not.toContain(DDL);
  });
});

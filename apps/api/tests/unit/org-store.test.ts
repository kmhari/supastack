import { describe, expect, it } from 'vitest';

// Mock the DB schema (table markers); keep @supastack/crypto REAL so generateRef
// produces a true 20-char lowercase ref we can assert on.
import { vi } from 'vitest';
vi.mock('@supastack/db', () => ({
  schema: {
    organizations: { __t: 'organizations' },
    organizationMembers: { __t: 'organizationMembers' },
  },
}));

const { createOrganizationWithOwner } = await import('../../src/services/org-store.js');
const { schema } = await import('@supastack/db');

function mockTx() {
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return Promise.resolve(undefined);
      },
    }),
  } as never;
  return { tx, inserts };
}

describe('createOrganizationWithOwner (feature 086 — shared org primitive)', () => {
  it('happy: inserts one org + one owner membership, returns {id,name}', async () => {
    const { tx, inserts } = mockTx();
    const out = await createOrganizationWithOwner(tx, { userId: 'user-123', name: 'Acme' });

    // returns the generated ref (20-char lowercase, CLI-compatible) + the name
    expect(out.name).toBe('Acme');
    expect(out.id).toMatch(/^[a-z]{20}$/);

    // exactly two inserts: organization first, then owner membership
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.table).toBe(schema.organizations);
    expect(inserts[0]!.values).toEqual({ id: out.id, name: 'Acme' });
    expect(inserts[1]!.table).toBe(schema.organizationMembers);
    expect(inserts[1]!.values).toEqual({ organizationId: out.id, userId: 'user-123', role: 'owner' });
  });

  it('contract: forwards `name` verbatim — the primitive does not trim/validate (caller does)', async () => {
    const { tx, inserts } = mockTx();
    const out = await createOrganizationWithOwner(tx, { userId: 'u', name: '  Spaced  ' });
    expect(out.name).toBe('  Spaced  ');
    expect(inserts[0]!.values.name).toBe('  Spaced  ');
  });

  it('generates a fresh ref per call (ids differ across calls)', async () => {
    const a = await createOrganizationWithOwner(mockTx().tx, { userId: 'u', name: 'A' });
    const b = await createOrganizationWithOwner(mockTx().tx, { userId: 'u', name: 'B' });
    expect(a.id).not.toBe(b.id);
  });
});

import { describe, it, expect } from 'vitest';
import {
  ROLES,
  ACTIONS,
  can,
  permissionMatrix,
  ROLE_IDS,
  ROLE_NAMES,
  roleToId,
  roleFromId,
  type Role,
  type Action,
} from '../src/rbac';

describe('rbac matrix (feature 084 — Cloud roles)', () => {
  const matrix = permissionMatrix();

  it('has exactly the four Cloud roles', () => {
    expect([...ROLES]).toEqual(['owner', 'administrator', 'developer', 'read_only']);
  });

  it('covers every (role × action) cell exactly once', () => {
    expect(matrix.length).toBe(ROLES.length * ACTIONS.length);
    const seen = new Set<string>();
    for (const { role, action } of matrix) {
      const key = `${role}:${action}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  for (const role of ROLES) {
    for (const action of ACTIONS) {
      it(`can(${role}, ${action}) matches matrix`, () => {
        const cell = matrix.find((c) => c.role === role && c.action === action)!;
        expect(can(role, action)).toBe(cell.allowed);
        expect(typeof cell.allowed).toBe('boolean');
      });
    }
  }

  // Happy paths
  it('owner is allowed every action except setup.run', () => {
    for (const action of ACTIONS) {
      expect(can('owner', action)).toBe(action !== 'setup.run');
    }
  });

  it('roles are cumulative: owner ⊇ administrator ⊇ developer ⊇ read_only', () => {
    const allowedSet = (r: Role) => new Set(ACTIONS.filter((a) => can(r, a)));
    const owner = allowedSet('owner');
    const admin = allowedSet('administrator');
    const dev = allowedSet('developer');
    const ro = allowedSet('read_only');
    for (const a of ro) expect(dev.has(a)).toBe(true);
    for (const a of dev) expect(admin.has(a)).toBe(true);
    for (const a of admin) expect(owner.has(a)).toBe(true);
  });

  it('every authenticated role may create a new org (org.create)', () => {
    for (const role of ROLES) expect(can(role, 'org.create')).toBe(true);
  });

  // Sad paths — denials that matter
  it('only owner can delete an org', () => {
    expect(can('owner', 'org.delete')).toBe(true);
    expect(can('administrator', 'org.delete')).toBe(false);
    expect(can('developer', 'org.delete')).toBe(false);
    expect(can('read_only', 'org.delete')).toBe(false);
  });

  it('developer cannot manage members', () => {
    for (const a of ['member.invite', 'member.remove', 'member.update-role'] as Action[]) {
      expect(can('developer', a)).toBe(false);
      expect(can('administrator', a)).toBe(true);
    }
  });

  it('read_only cannot write (no project create or db write)', () => {
    expect(can('read_only', 'instance.create')).toBe(false);
    expect(can('read_only', 'database.write')).toBe(false);
    expect(can('read_only', 'instance.read')).toBe(true);
  });

  it('no role may run setup (it is unauthenticated)', () => {
    for (const role of ROLES) expect(can(role, 'setup.run')).toBe(false);
  });

  it('unknown role / action returns false', () => {
    expect(can('ghost' as Role, 'org.read')).toBe(false);
    expect(can('owner', 'nope' as Action)).toBe(false);
  });
});

describe('role-id mapping (Studio wire contract)', () => {
  it('maps the four roles to stable numeric ids 1..4', () => {
    expect(ROLE_IDS).toEqual({ owner: 1, administrator: 2, developer: 3, read_only: 4 });
  });

  it('roleToId / roleFromId round-trip', () => {
    for (const role of ROLES) {
      expect(roleFromId(roleToId(role))).toBe(role);
    }
  });

  it('names match Studio FIXED_ROLE_ORDER', () => {
    expect(ROLE_NAMES).toEqual({
      owner: 'Owner',
      administrator: 'Administrator',
      developer: 'Developer',
      read_only: 'Read-only',
    });
  });

  it('roleFromId returns undefined for an unknown id', () => {
    expect(roleFromId(99)).toBeUndefined();
  });
});

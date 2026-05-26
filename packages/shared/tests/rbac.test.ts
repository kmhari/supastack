import { describe, it, expect } from 'vitest';
import { ROLES, ACTIONS, can, permissionMatrix, type Role, type Action } from '../src/rbac';

describe('rbac matrix', () => {
  const matrix = permissionMatrix();

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

  it('unknown role returns false', () => {
    expect(can('ghost' as Role, 'org.read' as Action)).toBe(false);
  });

  it('unknown action returns false', () => {
    expect(can('admin', 'nope' as Action)).toBe(false);
  });

  it('admin has every action allowed', () => {
    for (const action of ACTIONS) {
      expect(can('admin', action)).toBe(true);
    }
  });

  it('member has at least one denial and one allow', () => {
    const allowed = ACTIONS.filter((a) => can('member', a));
    const denied = ACTIONS.filter((a) => !can('member', a));
    expect(allowed.length).toBeGreaterThan(0);
    expect(denied.length).toBeGreaterThan(0);
  });
});

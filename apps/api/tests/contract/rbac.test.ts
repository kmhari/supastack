import { describe, expect, test } from 'vitest';
import { can, permissionMatrix, ROLES, ACTIONS } from '@selfbase/shared';

/**
 * RBAC matrix contract test (T047). Asserts the (role × action) permission
 * matrix is what we claim in `packages/shared/src/rbac.ts`. Anytime a new
 * action is added or a permission flipped, this test fails and forces an
 * explicit review.
 *
 * This is a UNIT-style test against the in-process matrix — no HTTP. The
 * HTTP integration tests live in `tests/integration/` and run against the
 * full stack in CI.
 */

describe('RBAC matrix', () => {
  test('every (role × action) cell is asserted', () => {
    const matrix = permissionMatrix();
    expect(matrix.length).toBe(ROLES.length * ACTIONS.length);
  });

  test('snapshot of permission matrix (regression watchdog)', () => {
    // Sort for deterministic output.
    const rows = permissionMatrix()
      .slice()
      .sort((a, b) => `${a.role}:${a.action}`.localeCompare(`${b.role}:${b.action}`))
      .map((r) => `${r.role}\t${r.action}\t${r.allowed ? 'ALLOW' : 'DENY'}`);
    expect(rows).toMatchInlineSnapshot(`
      [
        "admin	audit.read	ALLOW",
        "admin	auth_config.read	ALLOW",
        "admin	auth_config.write	ALLOW",
        "admin	backup.create	ALLOW",
        "admin	backup.download	ALLOW",
        "admin	backup.list	ALLOW",
        "admin	data_api_config.read	ALLOW",
        "admin	data_api_config.write	ALLOW",
        "admin	database_config.read	ALLOW",
        "admin	database_config.write	ALLOW",
        "admin	database.create-login-role	ALLOW",
        "admin	database.write	ALLOW",
        "admin	instance.create	ALLOW",
        "admin	instance.delete	ALLOW",
        "admin	instance.list	ALLOW",
        "admin	instance.pause	ALLOW",
        "admin	instance.pg-password.reset	ALLOW",
        "admin	instance.read	ALLOW",
        "admin	instance.restart	ALLOW",
        "admin	instance.resume	ALLOW",
        "admin	instance.reveal-credentials	ALLOW",
        "admin	instance.secrets.read	ALLOW",
        "admin	instance.secrets.write	ALLOW",
        "admin	instance.update	ALLOW",
        "admin	instance.upgrade	ALLOW",
        "admin	instance.vault.enable	ALLOW",
        "admin	member.invite	ALLOW",
        "admin	member.list	ALLOW",
        "admin	member.remove	ALLOW",
        "admin	org.backup-store.update	ALLOW",
        "admin	org.read	ALLOW",
        "admin	org.update	ALLOW",
        "admin	pooler.read	ALLOW",
        "admin	pooler.reconciler.run	ALLOW",
        "admin	pooler.reregister	ALLOW",
        "admin	setup.run	ALLOW",
        "admin	token.create	ALLOW",
        "admin	token.list	ALLOW",
        "admin	token.revoke	ALLOW",
        "member	audit.read	DENY",
        "member	auth_config.read	ALLOW",
        "member	auth_config.write	DENY",
        "member	backup.create	DENY",
        "member	backup.download	ALLOW",
        "member	backup.list	ALLOW",
        "member	data_api_config.read	ALLOW",
        "member	data_api_config.write	DENY",
        "member	database_config.read	ALLOW",
        "member	database_config.write	DENY",
        "member	database.create-login-role	DENY",
        "member	database.write	DENY",
        "member	instance.create	DENY",
        "member	instance.delete	DENY",
        "member	instance.list	ALLOW",
        "member	instance.pause	DENY",
        "member	instance.pg-password.reset	DENY",
        "member	instance.read	ALLOW",
        "member	instance.restart	DENY",
        "member	instance.resume	DENY",
        "member	instance.reveal-credentials	ALLOW",
        "member	instance.secrets.read	ALLOW",
        "member	instance.secrets.write	DENY",
        "member	instance.update	DENY",
        "member	instance.upgrade	DENY",
        "member	instance.vault.enable	DENY",
        "member	member.invite	DENY",
        "member	member.list	ALLOW",
        "member	member.remove	DENY",
        "member	org.backup-store.update	DENY",
        "member	org.read	ALLOW",
        "member	org.update	DENY",
        "member	pooler.read	ALLOW",
        "member	pooler.reconciler.run	DENY",
        "member	pooler.reregister	DENY",
        "member	setup.run	DENY",
        "member	token.create	ALLOW",
        "member	token.list	ALLOW",
        "member	token.revoke	ALLOW",
      ]
    `);
  });

  test('admin can do all destructive actions', () => {
    expect(can('admin', 'instance.delete')).toBe(true);
    expect(can('admin', 'instance.upgrade')).toBe(true);
    expect(can('admin', 'member.remove')).toBe(true);
    expect(can('admin', 'org.update')).toBe(true);
  });

  test('member is denied all destructive actions (FR-030)', () => {
    expect(can('member', 'instance.create')).toBe(false);
    expect(can('member', 'instance.delete')).toBe(false);
    expect(can('member', 'instance.upgrade')).toBe(false);
    expect(can('member', 'instance.pause')).toBe(false);
    expect(can('member', 'member.invite')).toBe(false);
    expect(can('member', 'member.remove')).toBe(false);
    expect(can('member', 'org.update')).toBe(false);
    expect(can('member', 'org.backup-store.update')).toBe(false);
  });

  test('member CAN reveal credentials (FR-030 + US4 scenario 2)', () => {
    // Members can see what's needed to use the instance, including secrets
    // behind the explicit reveal action. Admins additionally manage the
    // instance lifecycle.
    expect(can('member', 'instance.reveal-credentials')).toBe(true);
  });

  test('member can list and read but not change', () => {
    expect(can('member', 'instance.list')).toBe(true);
    expect(can('member', 'instance.read')).toBe(true);
    expect(can('member', 'instance.update')).toBe(false);
    expect(can('member', 'backup.list')).toBe(true);
    expect(can('member', 'backup.download')).toBe(true);
    expect(can('member', 'backup.create')).toBe(false);
  });
});

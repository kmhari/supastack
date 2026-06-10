import { describe, expect, test } from 'vitest';
import { can, permissionMatrix, ROLES, ACTIONS } from '@supastack/shared';

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
        "administrator	admin.certs.read	ALLOW",
        "administrator	admin.console.read	ALLOW",
        "administrator	admin.queues.read	ALLOW",
        "administrator	admin.resources.read	ALLOW",
        "administrator	audit.read	ALLOW",
        "administrator	auth_config.read	ALLOW",
        "administrator	auth_config.write	ALLOW",
        "administrator	backup.create	ALLOW",
        "administrator	backup.download	ALLOW",
        "administrator	backup.list	ALLOW",
        "administrator	backup.restore	ALLOW",
        "administrator	data_api_config.read	ALLOW",
        "administrator	data_api_config.write	ALLOW",
        "administrator	database_config.read	ALLOW",
        "administrator	database_config.write	ALLOW",
        "administrator	database.create-login-role	ALLOW",
        "administrator	database.write	ALLOW",
        "administrator	instance.create	ALLOW",
        "administrator	instance.delete	ALLOW",
        "administrator	instance.list	ALLOW",
        "administrator	instance.pause	ALLOW",
        "administrator	instance.pg-password.reset	ALLOW",
        "administrator	instance.read	ALLOW",
        "administrator	instance.restart	ALLOW",
        "administrator	instance.resume	ALLOW",
        "administrator	instance.reveal-credentials	ALLOW",
        "administrator	instance.secrets.read	ALLOW",
        "administrator	instance.secrets.write	ALLOW",
        "administrator	instance.update	ALLOW",
        "administrator	instance.upgrade	ALLOW",
        "administrator	instance.vault.enable	ALLOW",
        "administrator	member.invite	ALLOW",
        "administrator	member.list	ALLOW",
        "administrator	member.remove	ALLOW",
        "administrator	member.update-role	ALLOW",
        "administrator	oauth.consent.approve	ALLOW",
        "administrator	oauth.consent.read	ALLOW",
        "administrator	org.backup-store.update	ALLOW",
        "administrator	org.create	ALLOW",
        "administrator	org.delete	DENY",
        "administrator	org.read	ALLOW",
        "administrator	org.update	ALLOW",
        "administrator	pooler.read	ALLOW",
        "administrator	pooler.reconciler.run	ALLOW",
        "administrator	pooler.reregister	ALLOW",
        "administrator	setup.run	DENY",
        "administrator	token.create	ALLOW",
        "administrator	token.list	ALLOW",
        "administrator	token.revoke	ALLOW",
        "developer	admin.certs.read	DENY",
        "developer	admin.console.read	DENY",
        "developer	admin.queues.read	DENY",
        "developer	admin.resources.read	DENY",
        "developer	audit.read	ALLOW",
        "developer	auth_config.read	ALLOW",
        "developer	auth_config.write	ALLOW",
        "developer	backup.create	ALLOW",
        "developer	backup.download	ALLOW",
        "developer	backup.list	ALLOW",
        "developer	backup.restore	ALLOW",
        "developer	data_api_config.read	ALLOW",
        "developer	data_api_config.write	ALLOW",
        "developer	database_config.read	ALLOW",
        "developer	database_config.write	ALLOW",
        "developer	database.create-login-role	ALLOW",
        "developer	database.write	ALLOW",
        "developer	instance.create	ALLOW",
        "developer	instance.delete	ALLOW",
        "developer	instance.list	ALLOW",
        "developer	instance.pause	ALLOW",
        "developer	instance.pg-password.reset	ALLOW",
        "developer	instance.read	ALLOW",
        "developer	instance.restart	ALLOW",
        "developer	instance.resume	ALLOW",
        "developer	instance.reveal-credentials	ALLOW",
        "developer	instance.secrets.read	ALLOW",
        "developer	instance.secrets.write	ALLOW",
        "developer	instance.update	ALLOW",
        "developer	instance.upgrade	ALLOW",
        "developer	instance.vault.enable	ALLOW",
        "developer	member.invite	DENY",
        "developer	member.list	ALLOW",
        "developer	member.remove	DENY",
        "developer	member.update-role	DENY",
        "developer	oauth.consent.approve	DENY",
        "developer	oauth.consent.read	ALLOW",
        "developer	org.backup-store.update	DENY",
        "developer	org.create	ALLOW",
        "developer	org.delete	DENY",
        "developer	org.read	ALLOW",
        "developer	org.update	DENY",
        "developer	pooler.read	ALLOW",
        "developer	pooler.reconciler.run	ALLOW",
        "developer	pooler.reregister	ALLOW",
        "developer	setup.run	DENY",
        "developer	token.create	ALLOW",
        "developer	token.list	ALLOW",
        "developer	token.revoke	ALLOW",
        "owner	admin.certs.read	ALLOW",
        "owner	admin.console.read	ALLOW",
        "owner	admin.queues.read	ALLOW",
        "owner	admin.resources.read	ALLOW",
        "owner	audit.read	ALLOW",
        "owner	auth_config.read	ALLOW",
        "owner	auth_config.write	ALLOW",
        "owner	backup.create	ALLOW",
        "owner	backup.download	ALLOW",
        "owner	backup.list	ALLOW",
        "owner	backup.restore	ALLOW",
        "owner	data_api_config.read	ALLOW",
        "owner	data_api_config.write	ALLOW",
        "owner	database_config.read	ALLOW",
        "owner	database_config.write	ALLOW",
        "owner	database.create-login-role	ALLOW",
        "owner	database.write	ALLOW",
        "owner	instance.create	ALLOW",
        "owner	instance.delete	ALLOW",
        "owner	instance.list	ALLOW",
        "owner	instance.pause	ALLOW",
        "owner	instance.pg-password.reset	ALLOW",
        "owner	instance.read	ALLOW",
        "owner	instance.restart	ALLOW",
        "owner	instance.resume	ALLOW",
        "owner	instance.reveal-credentials	ALLOW",
        "owner	instance.secrets.read	ALLOW",
        "owner	instance.secrets.write	ALLOW",
        "owner	instance.update	ALLOW",
        "owner	instance.upgrade	ALLOW",
        "owner	instance.vault.enable	ALLOW",
        "owner	member.invite	ALLOW",
        "owner	member.list	ALLOW",
        "owner	member.remove	ALLOW",
        "owner	member.update-role	ALLOW",
        "owner	oauth.consent.approve	ALLOW",
        "owner	oauth.consent.read	ALLOW",
        "owner	org.backup-store.update	ALLOW",
        "owner	org.create	ALLOW",
        "owner	org.delete	ALLOW",
        "owner	org.read	ALLOW",
        "owner	org.update	ALLOW",
        "owner	pooler.read	ALLOW",
        "owner	pooler.reconciler.run	ALLOW",
        "owner	pooler.reregister	ALLOW",
        "owner	setup.run	DENY",
        "owner	token.create	ALLOW",
        "owner	token.list	ALLOW",
        "owner	token.revoke	ALLOW",
        "read_only	admin.certs.read	DENY",
        "read_only	admin.console.read	DENY",
        "read_only	admin.queues.read	DENY",
        "read_only	admin.resources.read	DENY",
        "read_only	audit.read	DENY",
        "read_only	auth_config.read	ALLOW",
        "read_only	auth_config.write	DENY",
        "read_only	backup.create	DENY",
        "read_only	backup.download	ALLOW",
        "read_only	backup.list	ALLOW",
        "read_only	backup.restore	DENY",
        "read_only	data_api_config.read	ALLOW",
        "read_only	data_api_config.write	DENY",
        "read_only	database_config.read	ALLOW",
        "read_only	database_config.write	DENY",
        "read_only	database.create-login-role	DENY",
        "read_only	database.write	DENY",
        "read_only	instance.create	DENY",
        "read_only	instance.delete	DENY",
        "read_only	instance.list	ALLOW",
        "read_only	instance.pause	DENY",
        "read_only	instance.pg-password.reset	DENY",
        "read_only	instance.read	ALLOW",
        "read_only	instance.restart	DENY",
        "read_only	instance.resume	DENY",
        "read_only	instance.reveal-credentials	ALLOW",
        "read_only	instance.secrets.read	ALLOW",
        "read_only	instance.secrets.write	DENY",
        "read_only	instance.update	DENY",
        "read_only	instance.upgrade	DENY",
        "read_only	instance.vault.enable	DENY",
        "read_only	member.invite	DENY",
        "read_only	member.list	ALLOW",
        "read_only	member.remove	DENY",
        "read_only	member.update-role	DENY",
        "read_only	oauth.consent.approve	DENY",
        "read_only	oauth.consent.read	ALLOW",
        "read_only	org.backup-store.update	DENY",
        "read_only	org.create	ALLOW",
        "read_only	org.delete	DENY",
        "read_only	org.read	ALLOW",
        "read_only	org.update	DENY",
        "read_only	pooler.read	ALLOW",
        "read_only	pooler.reconciler.run	DENY",
        "read_only	pooler.reregister	DENY",
        "read_only	setup.run	DENY",
        "read_only	token.create	ALLOW",
        "read_only	token.list	ALLOW",
        "read_only	token.revoke	ALLOW",
      ]
    `);
  });

  test('admin can do all destructive actions', () => {
    expect(can('owner', 'instance.delete')).toBe(true);
    expect(can('owner', 'instance.upgrade')).toBe(true);
    expect(can('owner', 'member.remove')).toBe(true);
    expect(can('owner', 'org.update')).toBe(true);
  });

  test('member is denied all destructive actions (FR-030)', () => {
    expect(can('read_only', 'instance.create')).toBe(false);
    expect(can('read_only', 'instance.delete')).toBe(false);
    expect(can('read_only', 'instance.upgrade')).toBe(false);
    expect(can('read_only', 'instance.pause')).toBe(false);
    expect(can('read_only', 'member.invite')).toBe(false);
    expect(can('read_only', 'member.remove')).toBe(false);
    expect(can('read_only', 'org.update')).toBe(false);
    expect(can('read_only', 'org.backup-store.update')).toBe(false);
  });

  test('member CAN reveal credentials (FR-030 + US4 scenario 2)', () => {
    // Members can see what's needed to use the instance, including secrets
    // behind the explicit reveal action. Admins additionally manage the
    // instance lifecycle.
    expect(can('read_only', 'instance.reveal-credentials')).toBe(true);
  });

  test('member can list and read but not change', () => {
    expect(can('read_only', 'instance.list')).toBe(true);
    expect(can('read_only', 'instance.read')).toBe(true);
    expect(can('read_only', 'instance.update')).toBe(false);
    expect(can('read_only', 'backup.list')).toBe(true);
    expect(can('read_only', 'backup.download')).toBe(true);
    expect(can('read_only', 'backup.create')).toBe(false);
  });
});

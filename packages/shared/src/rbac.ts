export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  // setup + org
  'setup.run',
  'org.read',
  'org.update',
  'org.backup-store.update',
  // members + invites
  'member.list',
  'member.invite',
  'member.remove',
  // tokens
  'token.create',
  'token.list',
  'token.revoke',
  // instances
  'instance.create',
  'instance.list',
  'instance.read',
  'instance.update',
  'instance.delete',
  'instance.pause',
  'instance.resume',
  'instance.restart',
  'instance.upgrade',
  'instance.reveal-credentials',
  // backups
  'backup.create',
  'backup.list',
  'backup.download',
  // audit
  'audit.read',
  // feature 008 — pooler resilience
  'pooler.read',
  'pooler.reregister',
  'pooler.reconciler.run',
  'instance.pg-password.reset',
  // feature 009 — runtime config tunables (postgres-config + auth-config)
  'data_api_config.read',
  'data_api_config.write',
  'auth_config.read',
  'auth_config.write',
  // feature 010 — secrets management (vault-backed)
  'instance.secrets.read',
  'instance.secrets.write',
  'instance.vault.enable',
  // feature 012 — CLI login-role (passwordless `supabase db push`)
  'database.create-login-role',
  // feature 013 — db query + db dump endpoints (admin-only SQL + pg_dump)
  'database.write',
] as const;
export type Action = (typeof ACTIONS)[number];

// Authoritative permission matrix. `true` = allowed.
// Member denials match spec.md FR-030.
const MATRIX: Record<Role, Record<Action, boolean>> = {
  admin: {
    'setup.run': true,
    'org.read': true,
    'org.update': true,
    'org.backup-store.update': true,
    'member.list': true,
    'member.invite': true,
    'member.remove': true,
    'token.create': true,
    'token.list': true,
    'token.revoke': true,
    'instance.create': true,
    'instance.list': true,
    'instance.read': true,
    'instance.update': true,
    'instance.delete': true,
    'instance.pause': true,
    'instance.resume': true,
    'instance.restart': true,
    'instance.upgrade': true,
    'instance.reveal-credentials': true,
    'backup.create': true,
    'backup.list': true,
    'backup.download': true,
    'audit.read': true,
    'pooler.read': true,
    'pooler.reregister': true,
    'pooler.reconciler.run': true,
    'instance.pg-password.reset': true,
    'data_api_config.read': true,
    'data_api_config.write': true,
    'auth_config.read': true,
    'auth_config.write': true,
    'instance.secrets.read': true,
    'instance.secrets.write': true,
    'instance.vault.enable': true,
    'database.create-login-role': true,
    'database.write': true,
  },
  member: {
    'setup.run': false, // setup only runs unauthenticated, before any user exists
    'org.read': true,
    'org.update': false,
    'org.backup-store.update': false,
    'member.list': true,
    'member.invite': false,
    'member.remove': false,
    'token.create': true,
    'token.list': true,
    'token.revoke': true, // own tokens only — enforced in route handler
    'instance.create': false,
    'instance.list': true,
    'instance.read': true,
    'instance.update': false,
    'instance.delete': false,
    'instance.pause': false,
    'instance.resume': false,
    'instance.restart': false,
    'instance.upgrade': false,
    'instance.reveal-credentials': true, // per spec FR-030 + US4 scenario 2
    'backup.create': false,
    'backup.list': true,
    'backup.download': true,
    'audit.read': false,
    'pooler.read': true, // dashboard read for members is fine
    'pooler.reregister': false,
    'pooler.reconciler.run': false,
    'instance.pg-password.reset': false,
    'data_api_config.read': true,
    'data_api_config.write': false,
    'auth_config.read': true,
    'auth_config.write': false,
    'instance.secrets.read': true, // members can view digests (no plaintext) — read-only dashboard view
    'instance.secrets.write': false,
    'instance.vault.enable': false,
    'database.create-login-role': false, // members cannot mint write-capable PG creds via CLI exchange
    'database.write': false, // members cannot run arbitrary SQL or pg_dump (admin-only superuser surface)
  },
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role]?.[action] ?? false;
}

/** Used by RBAC matrix contract test — every (role × action) cell is asserted. */
export function permissionMatrix(): ReadonlyArray<{
  role: Role;
  action: Action;
  allowed: boolean;
}> {
  const out: { role: Role; action: Action; allowed: boolean }[] = [];
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      out.push({ role, action, allowed: MATRIX[role][action] });
    }
  }
  return out;
}

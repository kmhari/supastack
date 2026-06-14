// Feature 084 — Supabase-Cloud-style org roles (Owner ⊇ Administrator ⊇
// Developer ⊇ Read-only), org-scoped. Roles are exposed to the dashboard as
// objects with stable NUMERIC ids (Studio assigns by role_id); storage uses the
// string enum below and maps 1:1.

export const ROLES = ['owner', 'administrator', 'developer', 'read_only'] as const;
export type Role = (typeof ROLES)[number];

/** Stable numeric ids for the wire (Studio `role_id` / `role_ids[]`). */
export const ROLE_IDS = {
  owner: 1,
  administrator: 2,
  developer: 3,
  read_only: 4,
} as const satisfies Record<Role, number>;

/** Display names exactly as Studio's FIXED_ROLE_ORDER expects. */
export const ROLE_NAMES = {
  owner: 'Owner',
  administrator: 'Administrator',
  developer: 'Developer',
  read_only: 'Read-only',
} as const satisfies Record<Role, string>;

const ROLE_BY_ID: Record<number, Role> = {
  1: 'owner',
  2: 'administrator',
  3: 'developer',
  4: 'read_only',
};

export function roleToId(role: Role): number {
  return ROLE_IDS[role];
}
export function roleFromId(id: number): Role | undefined {
  return ROLE_BY_ID[id];
}

export const ACTIONS = [
  // setup + org
  'setup.run',
  'org.read',
  'org.create',
  'org.update',
  'org.delete',
  'org.backup-store.update',
  // members + invites
  'member.list',
  'member.invite',
  'member.update-role',
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
  // feature 009 — runtime config tunables
  'data_api_config.read',
  'data_api_config.write',
  'auth_config.read',
  'auth_config.write',
  // feature 026 — supabase config push compat
  'database_config.read',
  'database_config.write',
  // feature 010 — secrets management
  'instance.secrets.read',
  'instance.secrets.write',
  'instance.vault.enable',
  // feature 012 — CLI login-role
  'database.create-login-role',
  // feature 013 — db query + db dump
  'database.write',
  // feature 019 — async backup restore
  'backup.restore',
  // feature 115 — OAuth consent (MCP authorize flow)
  'oauth.consent.read',
  'oauth.consent.approve',
  // feature 116 — admin ops console (installation-wide, read-only)
  'admin.console.read',
  'admin.resources.read',
  'admin.queues.read',
  'admin.certs.read',
] as const;
export type Action = (typeof ACTIONS)[number];

// Capability tiers, cumulative (each role inherits the one below it).
// `org.create` is allowed for every role — creating a NEW org you own is not
// gated by your role in an existing org. `setup.run` is in no tier (it runs
// unauthenticated, before any role exists).
const READ_ONLY: Action[] = [
  'org.read',
  'org.create',
  'member.list',
  'token.create',
  'token.list',
  'token.revoke',
  'instance.list',
  'instance.read',
  'instance.reveal-credentials',
  'backup.list',
  'backup.download',
  'pooler.read',
  'data_api_config.read',
  'auth_config.read',
  'database_config.read',
  'instance.secrets.read',
  // feature 115 — any authenticated member may read a pending OAuth authorization
  // (the auth_id is a capability token).
  'oauth.consent.read',
];

const DEVELOPER_EXTRA: Action[] = [
  'instance.create',
  'instance.update',
  'instance.delete',
  'instance.pause',
  'instance.resume',
  'instance.restart',
  'instance.upgrade',
  'instance.pg-password.reset',
  'backup.create',
  'backup.restore',
  'instance.secrets.write',
  'instance.vault.enable',
  'data_api_config.write',
  'auth_config.write',
  'database_config.write',
  'database.create-login-role',
  'database.write',
  'pooler.reregister',
  'pooler.reconciler.run',
  'audit.read',
];

const ADMIN_EXTRA: Action[] = [
  'member.invite',
  'member.update-role',
  'member.remove',
  'org.update',
  'org.backup-store.update',
  // feature 115 — granting an MCP client a broad-scope token is owner/admin-only.
  'oauth.consent.approve',
  // feature 116 — the admin ops console is installation-admin-only (owner + administrator).
  'admin.console.read',
  'admin.resources.read',
  'admin.queues.read',
  'admin.certs.read',
];

const OWNER_EXTRA: Action[] = ['org.delete'];

const developerGrants = [...READ_ONLY, ...DEVELOPER_EXTRA];
const administratorGrants = [...developerGrants, ...ADMIN_EXTRA];
const ownerGrants = [...administratorGrants, ...OWNER_EXTRA];

const GRANTS: Record<Role, Action[]> = {
  read_only: READ_ONLY,
  developer: developerGrants,
  administrator: administratorGrants,
  owner: ownerGrants,
};

// Authoritative permission matrix — every (role × action) cell defined.
const MATRIX: Record<Role, Record<Action, boolean>> = Object.fromEntries(
  ROLES.map((role) => [
    role,
    Object.fromEntries(ACTIONS.map((action) => [action, GRANTS[role].includes(action)])),
  ]),
) as Record<Role, Record<Action, boolean>>;

export function can(role: Role, action: Action): boolean {
  return MATRIX[role]?.[action] ?? false;
}

/** Used by the RBAC matrix contract test — every (role × action) cell asserted. */
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

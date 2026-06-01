/**
 * Single source of truth for the browser-test coverage.
 *
 * Consumers:
 *   - tests/e2e/page-smokes.spec.ts iterates EXPECTED_PAGES to assert each
 *     page renders without console errors
 *   - tests/e2e/sidebar-nav.spec.ts iterates PROJECT_SHELL_GROUPS to assert
 *     every sidebar entry is wired
 *   - scripts/check-page-coverage.mjs diffs files under src/pages/ against
 *     EXPECTED_PAGES + EXCLUDED_PAGES and fails when one is added without
 *     the other (FR-010)
 *
 * Spec: specs/021-dashboard-browser-tests/data-model.md §1–§3, §7
 * Contract: specs/021-dashboard-browser-tests/contracts/expected-pages.md
 * Task: T009
 */

export interface ExpectedPage {
  /** URL path; use `{ref}` placeholder for the project ref (substituted by the test). */
  path: string;
  /** Visible heading text the test asserts is on the page after navigation. */
  headline: string;
  /** True when the path contains `{ref}` and needs the test-project fixture. */
  requiresProject: boolean;
  /** Source file under apps/web/src/pages/. When omitted, the lint script
   * infers from path via the standard naming convention. */
  sourceFile?: string;
}

export interface SidebarItem {
  label: string;
  /** URL suffix appended to `/dashboard/project/${ref}` for project-shell items,
   * or the full path for settings-shell items. */
  suffix: string;
}

export interface SidebarGroup {
  heading: string;
  items: ReadonlyArray<SidebarItem>;
}

export interface ExcludedPage {
  file: string;
  reason: string;
}

// ─── Project-shell pages ────────────────────────────────────────────────────

const PROJECT_PAGES: ReadonlyArray<ExpectedPage> = [
  {
    path: '/dashboard/project/{ref}',
    headline: 'General',
    requiresProject: true,
    sourceFile: 'ProjectGeneral.tsx',
  },
  {
    path: '/dashboard/project/{ref}/api-keys',
    headline: 'API Keys',
    requiresProject: true,
    sourceFile: 'ProjectApiKeys.tsx',
  },
  {
    path: '/dashboard/project/{ref}/jwt-keys',
    headline: 'JWT Keys',
    requiresProject: true,
    sourceFile: 'ProjectJwtKeys.tsx',
  },
  {
    path: '/dashboard/project/{ref}/secrets',
    headline: 'Secrets',
    requiresProject: true,
    sourceFile: 'ProjectSecrets.tsx',
  },
  {
    path: '/dashboard/project/{ref}/backups',
    headline: 'Backups',
    requiresProject: true,
    sourceFile: 'InstanceBackups.tsx',
  },
  {
    path: '/dashboard/project/{ref}/auth/providers',
    headline: 'Auth Providers',
    requiresProject: true,
    sourceFile: 'ProjectAuthProviders.tsx',
  },
  {
    path: '/dashboard/project/{ref}/auth/url-configuration',
    headline: 'URL Configuration',
    requiresProject: true,
    sourceFile: 'ProjectAuthUrlConfig.tsx',
  },
  {
    path: '/dashboard/project/{ref}/auth/hooks',
    headline: 'Auth Hooks',
    requiresProject: true,
    sourceFile: 'ProjectAuthHooks.tsx',
  },
  {
    path: '/dashboard/project/{ref}/health',
    headline: 'Health',
    requiresProject: true,
    sourceFile: 'ProjectHealth.tsx',
  },
];

// ─── Settings-shell pages (org-level) ───────────────────────────────────────

const SETTINGS_PAGES: ReadonlyArray<ExpectedPage> = [
  {
    path: '/settings/org',
    headline: 'Overview',
    requiresProject: false,
    sourceFile: 'SettingsOrg.tsx',
  },
  {
    path: '/settings/members',
    headline: 'Members',
    requiresProject: false,
    sourceFile: 'SettingsMembers.tsx',
  },
  {
    path: '/settings/tokens',
    headline: 'Tokens',
    requiresProject: false,
    sourceFile: 'SettingsTokens.tsx',
  },
  {
    path: '/settings/cli',
    headline: 'CLI integration',
    requiresProject: false,
    sourceFile: 'SettingsCli.tsx',
  },
  {
    path: '/settings/mcp-clients',
    headline: 'Connected MCP clients',
    requiresProject: false,
    sourceFile: 'SettingsMcpClients.tsx',
  },
  {
    path: '/settings/database',
    headline: 'Database',
    requiresProject: false,
    sourceFile: 'SettingsDatabase.tsx',
  },
  {
    path: '/settings/audit',
    headline: 'Audit',
    requiresProject: false,
    sourceFile: 'SettingsAudit.tsx',
  },
];

// ─── Top-level pages ────────────────────────────────────────────────────────

const TOP_PAGES: ReadonlyArray<ExpectedPage> = [
  { path: '/dashboard', headline: 'Projects', requiresProject: false, sourceFile: 'Instances.tsx' },
];

export const EXPECTED_PAGES: ReadonlyArray<ExpectedPage> = [
  ...PROJECT_PAGES,
  ...SETTINGS_PAGES,
  ...TOP_PAGES,
];

// ─── Sidebar registries (mirror ProjectShell.tsx + SettingsLayout.tsx) ─────

export const PROJECT_SHELL_GROUPS: ReadonlyArray<SidebarGroup> = [
  {
    heading: 'Configuration',
    items: [
      { label: 'General', suffix: '' },
      { label: 'API Keys', suffix: '/api-keys' },
      { label: 'JWT Keys', suffix: '/jwt-keys' },
      { label: 'Secrets', suffix: '/secrets' },
      { label: 'Backups', suffix: '/backups' },
    ],
  },
  {
    heading: 'Authentication',
    items: [
      { label: 'Providers', suffix: '/auth/providers' },
      { label: 'URL Configuration', suffix: '/auth/url-configuration' },
      { label: 'Hooks', suffix: '/auth/hooks' },
    ],
  },
  {
    heading: 'Diagnostics',
    items: [{ label: 'Health', suffix: '/health' }],
  },
];

export const SETTINGS_SHELL_ITEMS: ReadonlyArray<SidebarItem> = [
  { label: 'Overview', suffix: '/settings/org' },
  { label: 'Members', suffix: '/settings/members' },
  { label: 'Tokens', suffix: '/settings/tokens' },
  { label: 'CLI integration', suffix: '/settings/cli' },
  { label: 'MCP clients', suffix: '/settings/mcp-clients' },
  { label: 'Database', suffix: '/settings/database' },
  { label: 'Audit', suffix: '/settings/audit' },
];

// ─── Explicit exclusions ────────────────────────────────────────────────────
//
// Files under apps/web/src/pages/ that intentionally do not have a browser
// smoke. New additions need a written reason; the lint reads this list.

export const EXCLUDED_PAGES: ReadonlyArray<ExcludedPage> = [
  { file: 'Login.tsx', reason: 'Pre-auth page; tested implicitly by every admin-fixture login' },
  { file: 'Setup.tsx', reason: 'Bootstrap flow; covered by golden-path.spec.ts' },
  { file: 'AcceptInvite.tsx', reason: 'Covered by invite-flow.spec.ts' },
  { file: 'CliLogin.tsx', reason: 'PKCE CLI flow; smoke covered by tests/cli-e2e/cli-login.sh' },
  { file: 'ConnectCli.tsx', reason: 'Static info page; no interaction' },
  { file: 'InstancesNew.tsx', reason: 'Covered by golden-path.spec.ts' },
];

// ─── Console error allowlist (per research R-005) ───────────────────────────
//
// Console errors matching any of these patterns are considered noise from
// dev-mode tooling (React DevTools nudge, CSP dev warnings) and not failures.
// Anything outside the allowlist fails the page-smoke test.

export const CONSOLE_ERROR_ALLOWLIST: ReadonlyArray<RegExp> = [
  /React DevTools/i,
  /Download the React DevTools/i,
  /violates the following Content Security Policy.*style-src/i,
];

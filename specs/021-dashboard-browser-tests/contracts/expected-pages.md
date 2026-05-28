# Contract: Expected Pages Registry

**Feature**: 021-dashboard-browser-tests

This document is the canonical list of dashboard pages covered by the browser-test suite. It backs both the runtime assertions (per-page smoke iterates over the table) and the coverage lint (CI fails when a new page is added without an entry).

---

## Project-shell pages (require a seeded test project)

| Path                                              | Headline           | Source file                |
|---------------------------------------------------|--------------------|----------------------------|
| `/dashboard/project/{ref}`                        | General            | `ProjectGeneral.tsx`       |
| `/dashboard/project/{ref}/api-keys`               | API Keys           | `ProjectApiKeys.tsx`       |
| `/dashboard/project/{ref}/jwt-keys`               | JWT Keys           | `ProjectJwtKeys.tsx`       |
| `/dashboard/project/{ref}/secrets`                | Secrets            | `ProjectSecrets.tsx`       |
| `/dashboard/project/{ref}/backups`                | Backups            | `InstanceBackups.tsx`      |
| `/dashboard/project/{ref}/auth/providers`         | Auth Providers     | `ProjectAuthProviders.tsx` |
| `/dashboard/project/{ref}/health`                 | Health             | `ProjectHealth.tsx`        |

---

## Settings-shell pages (org-level, no project ref)

| Path                       | Headline         | Source file              |
|----------------------------|------------------|--------------------------|
| `/settings/members`        | Members          | `SettingsMembers.tsx`    |
| `/settings/tokens`         | Personal Tokens  | `SettingsTokens.tsx`     |
| `/settings/audit`          | Audit            | `SettingsAudit.tsx`      |
| `/settings/database`       | Database         | `SettingsDatabase.tsx`   |
| `/settings/cli`            | CLI              | `SettingsCli.tsx`        |
| `/settings/mcp-clients`    | MCP Clients      | `SettingsMcpClients.tsx` |

---

## Top-level pages

| Path                | Headline   | Source file       |
|---------------------|------------|-------------------|
| `/dashboard`        | Projects   | `Instances.tsx`   |

---

## Sidebar groups

### Project shell

| Group           | Entries                                                     |
|-----------------|-------------------------------------------------------------|
| Configuration   | General, API Keys, JWT Keys, Secrets, Backups              |
| Authentication  | Providers                                                   |
| Diagnostics     | Health                                                      |

### Settings shell

(To be populated during implementation by reading `SettingsLayout.tsx`.)

---

## Explicitly excluded pages

| Source file              | Reason                                                                  |
|--------------------------|-------------------------------------------------------------------------|
| `Login.tsx`              | Pre-auth page; covered implicitly by every admin-fixture login          |
| `Setup.tsx`              | Bootstrap flow; covered by `golden-path.spec.ts`                        |
| `AcceptInvite.tsx`       | Covered by `invite-flow.spec.ts`                                        |
| `CliLogin.tsx`           | PKCE CLI flow; smoke covered by `tests/cli-e2e/cli-login.sh`            |
| `ConnectCli.tsx`         | Static info page; no interaction                                        |
| `InstancesNew.tsx`       | Covered by `golden-path.spec.ts`                                        |
| `SettingsOrg.tsx`        | (TBD during implementation — covered by org-management spec?)           |

---

## Coverage lint behavior

**`apps/web/scripts/check-page-coverage.mjs`** runs as part of `pnpm lint`:

1. Lists files under `apps/web/src/pages/*.tsx` matching the dashboard-page convention (file basename ending in `Page.tsx` OR matching `Project*.tsx`, `Settings*.tsx`, `Instances*.tsx`).
2. Reads the table above (extracted from `EXPECTED_PAGES` + `EXCLUDED_PAGES`).
3. Asserts every file is in exactly one set (covered OR explicitly excluded). Files in neither fail the lint with:
   ```
   ❌ apps/web/src/pages/NewFeature.tsx has no browser-test smoke.
      Add an entry to EXPECTED_PAGES in apps/web/tests/e2e/expected-pages.ts,
      or add it to EXCLUDED_PAGES with a reason.
   ```
4. Files in `EXPECTED_PAGES` whose source file no longer exists fail the lint with:
   ```
   ❌ EXPECTED_PAGES entry for `<path>` references a missing source file (<file>).
   ```

---

## Invariants the lint enforces

1. **No silently-untested pages**. Every dashboard file under `apps/web/src/pages/` is covered or explicitly excluded with a reason.
2. **No dead entries**. The registry doesn't reference deleted page files.
3. **Single source of truth**. Sidebar groups in `expected-pages.ts` match `ProjectShell.tsx`'s rendered structure — this is the test the sidebar-nav spec asserts at runtime.

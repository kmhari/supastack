# Data Model: Dashboard Browser-Level E2E Tests

**Feature**: 021-dashboard-browser-tests | **Date**: 2026-05-28

No database tables. No new persistent state. This document captures the in-memory shapes the test harness operates on.

---

## 1. `ExpectedPage`

**Location**: `apps/web/tests/e2e/expected-pages.ts`

Single source of truth that the per-page smoke (US3) iterates over and that the coverage lint (FR-010) compares against the filesystem.

```ts
export interface ExpectedPage {
  /** URL path on the dashboard. Use `{ref}` placeholder for the project ref; the
   * test-project fixture substitutes the seeded test project's ref at runtime. */
  path: string;

  /** Visible heading text the test asserts is on the page after navigation. */
  headline: string;

  /** True when the path contains `{ref}` and needs the test-project fixture. */
  requiresProject: boolean;

  /** Optional: page file under `apps/web/src/pages/`. When omitted, the lint
   * script infers the file name from `path` via the standard naming convention.
   * Set explicitly for pages with non-standard file names. */
  sourceFile?: string;
}

export const EXPECTED_PAGES: ReadonlyArray<ExpectedPage>;
```

**Initial entries** (~14): one per project-shell page + one per settings page (see contracts/expected-pages.md for the canonical list).

**Invariants**:
- Every entry's `path` must resolve to a real route in `apps/web/src/App.tsx`.
- Every entry's `headline` must match the `<h1>` or page title rendered at that path.
- Every file under `apps/web/src/pages/*.tsx` matching the dashboard-page convention either has an entry in `EXPECTED_PAGES` OR an entry in `EXCLUDED_PAGES` with reason.

---

## 2. `SidebarGroup` + `SidebarItem`

**Location**: `apps/web/tests/e2e/expected-pages.ts` (exported alongside `EXPECTED_PAGES`).

The shape the sidebar-nav spec (US1) iterates over to assert every group and entry is rendered.

```ts
export interface SidebarItem {
  /** Visible label text rendered in the sidebar link. */
  label: string;
  /** URL suffix appended to `/dashboard/project/${ref}` for project-shell items,
   * or the full path for settings-shell items. */
  suffix: string;
}

export interface SidebarGroup {
  /** Visible heading rendered above the group (e.g. "Configuration"). */
  heading: string;
  items: ReadonlyArray<SidebarItem>;
}

export const PROJECT_SHELL_GROUPS: ReadonlyArray<SidebarGroup>;
export const SETTINGS_SHELL_GROUPS: ReadonlyArray<SidebarGroup>;
```

**Counts at merge time**:
- `PROJECT_SHELL_GROUPS`: 3 (Configuration, Authentication, Diagnostics). Mirrors `apps/web/src/components/ProjectShell.tsx`.
- `SETTINGS_SHELL_GROUPS`: depends on `apps/web/src/components/SettingsLayout.tsx` structure; counted at implementation time.

**Invariant**: the union of all `(group.heading, item.label)` pairs in `PROJECT_SHELL_GROUPS` equals the set rendered by `<ProjectShell>` when an admin loads any project page.

---

## 3. `EXCLUDED_PAGES`

**Location**: same file.

Explicit allowlist of pages under `apps/web/src/pages/*.tsx` that do NOT require browser-test coverage. Each entry has a reason.

```ts
export interface ExcludedPage {
  file: string;     // basename, e.g. "Login.tsx"
  reason: string;   // why no test, e.g. "Pre-auth page; covered by setup spec"
}

export const EXCLUDED_PAGES: ReadonlyArray<ExcludedPage>;
```

**Examples** (initial):
- `Login.tsx` — "Pre-auth page; tested implicitly by every admin-fixture login"
- `Setup.tsx` — "Bootstrap flow; covered by golden-path.spec.ts"
- `AcceptInvite.tsx` — "Covered by invite-flow.spec.ts"
- `CliLogin.tsx` — "PKCE CLI flow; smoke covered by tests/cli-e2e"
- `ConnectCli.tsx` — "Static info page; no interaction"
- `InstancesNew.tsx` — "Covered by golden-path.spec.ts"

---

## 4. `AdminSessionFixture`

**Location**: `apps/web/tests/e2e/fixtures/admin-session.ts`

Playwright fixture type. The `test` function from this module extends Playwright's base `test` with the `adminContext` property.

```ts
interface AdminSessionFixture {
  /** A Playwright BrowserContext pre-authenticated as the seeded admin. */
  adminContext: import('@playwright/test').BrowserContext;
}
```

**Lifecycle**:
1. First call per spec file: load `storageState.json` from disk (cached across runs) OR perform login flow against `/api/v1/auth/login` with seeded credentials and write the cookies to `storageState.json`.
2. Create a new browser context with the loaded state.
3. Yield to test.
4. Close the context after the spec finishes.

---

## 5. `TestProjectFixture`

**Location**: `apps/web/tests/e2e/fixtures/test-project.ts`

Function returning the ref of a pre-seeded test project, creating it on first call.

```ts
export async function testProjectRef(): Promise<string>;
```

**Lifecycle**:
1. First call (per CI run): `POST /api/v1/instances` with `name: 'e2e-test-project'` against the test stack. Returns a 20-char ref.
2. Cache the ref in `globalThis.__e2eTestProjectRef`.
3. Subsequent calls: return the cached ref.

**Cleanup**: not performed (the disposable CI stack is destroyed at the end of the run; local devs use `docker compose down -v` to wipe).

---

## 6. `RedactionPattern`

**Location**: `apps/web/tests/e2e/redactor.ts`

```ts
interface RedactionPattern {
  pattern: RegExp;
  /** Replacement string. Use a stable token so test failures don't depend on the
   * original secret length. */
  replacement: string;
}

export const REDACTION_PATTERNS: ReadonlyArray<RedactionPattern>;
```

**Initial set**:
- PAT: `/sbp_[a-f0-9]{40}/g` → `'sbp_REDACTED'`
- Bearer header: `/Bearer [A-Za-z0-9._-]+/g` → `'Bearer REDACTED'`
- Session cookie value: `/sb_sid=[A-Za-z0-9-_]+/g` → `'sb_sid=REDACTED'`

Pattern set is intentionally small + auditable; extensions go through PR review.

---

## 7. `ConsoleErrorAllowlist`

**Location**: same module as the page-smoke spec.

```ts
export const CONSOLE_ERROR_ALLOWLIST: ReadonlyArray<RegExp>;
```

Initial set (per research R-005):
- `/React DevTools/i`
- `/Download the React DevTools/i`
- `/violates the following Content Security Policy.*style-src/i`

Tests fail on any console message at `error` level that does not match an allowlist entry.

---

## No DB, no API contracts

This feature does not add any database tables, API endpoints, or wire-format contracts. It is purely a test-harness layer.

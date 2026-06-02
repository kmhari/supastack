# Feature Specification: Migrate UI Primitives to Supabase Design System

**Feature Branch**: `084-migrate-ui-primitives`

**Created**: 2026-06-02

**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Eliminate Duplicate Primitive Maintenance (Priority: P1)

A dashboard developer modifying a feature no longer needs to maintain or patch supastack's own copies of UI primitives (button, input, dialog, select, etc.). They work with the same components Supabase Studio uses, inheriting upstream improvements and fixes automatically.

**Why this priority**: Removes an entire class of maintenance burden. Every future upstream improvement (accessibility, new variants, bug fixes) becomes available without manual porting. The current 21-file primitive folder becomes dead weight we no longer carry.

**Independent Test**: A developer creates a new dashboard page using only the migrated import paths and every component renders and behaves correctly without any custom primitive file being consulted.

**Acceptance Scenarios**:

1. **Given** a developer imports a button component for a new page, **When** they write the import, **Then** the import comes from the shared Supabase library rather than a file local to supastack's `ui/` folder
2. **Given** supastack's own primitive file for any migrated component is removed, **When** the dashboard is built, **Then** the build succeeds with zero errors
3. **Given** the Supabase library releases an update to a shared component, **When** the library version is bumped, **Then** the updated component is available to supastack without any further code changes

---

### User Story 2 - Visual Consistency with Supabase Studio (Priority: P2)

An operator visiting both the supastack dashboard and the per-project Studio interface sees consistent button styles, input styles, dialogs, and color tokens — the two interfaces feel like the same product family.

**Why this priority**: Currently supastack's primitives are shadcn copies with their own variant definitions and CSS tokens, while Studio uses Supabase's design system. The two surfaces look noticeably different. Alignment reduces operator confusion and makes the platform feel more polished.

**Independent Test**: Open the supastack dashboard and a per-project Studio side by side. Primary buttons, text inputs, and dialogs share the same visual language (color palette, radius, sizing).

**Acceptance Scenarios**:

1. **Given** a primary call-to-action button in the supastack dashboard, **When** compared to a primary button in Supabase Studio, **Then** both use the same brand color, border-radius, and focus ring style
2. **Given** a form input in the supastack dashboard, **When** compared to a form input in Supabase Studio, **Then** sizing, border treatment, and focus state are visually equivalent
3. **Given** a modal/dialog in the supastack dashboard, **When** opened, **Then** it matches the overlay style and close-button placement of Studio's dialogs

---

### User Story 3 - No Regression on Existing Dashboard Pages (Priority: P3)

Every existing dashboard page continues to work correctly after the migration. No page loses functionality, no form breaks, no layout shifts appear.

**Why this priority**: The migration must be transparent to end users. Operators who relied on current styling and behavior must see no disruption.

**Independent Test**: Load each current dashboard page (settings, auth providers, secrets, URL configuration, hooks, tokens, etc.) and interact with every form control; all interactions complete successfully.

**Acceptance Scenarios**:

1. **Given** any existing dashboard page, **When** loaded after migration, **Then** no visual layout regression is observable compared to pre-migration screenshots
2. **Given** a form that previously used a local `<Button>`, `<Input>`, or `<Select>`, **When** interacted with post-migration, **Then** it behaves identically (same loading states, disabled states, error states)
3. **Given** the full dashboard Playwright e2e suite, **When** run against the migrated codebase, **Then** all tests pass

---

### Edge Cases

- What happens to primitives that have no direct equivalent in Supabase's library (e.g. `input-with-suffix`, `sonner` toast wrapper)? They must either remain as local files or be replaced with the closest equivalent.
- How do components that use supastack-specific CSS tokens (defined in `index.css @theme`) behave if Supabase's library uses different token names?
- What happens to variant names that exist in supastack's API but not in Supabase's API (or vice versa)? Every call site using a removed variant must be updated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All UI primitives that have a direct equivalent in the Supabase shared component library MUST be sourced from that library rather than from supastack-local files
- **FR-002**: Supastack-local primitive files for migrated components MUST be removed; no component may be provided by both the library and a local file simultaneously
- **FR-003**: Every dashboard page and component that previously used a local primitive MUST be updated to use the library import with no orphaned references remaining
- **FR-004**: Components with no direct library equivalent (e.g. `input-with-suffix`, toast configuration) MAY remain as local files; these are explicitly excluded from migration scope and documented
- **FR-005**: The full Playwright e2e suite MUST pass after migration with no new test failures
- **FR-006**: The TypeScript build MUST succeed with zero new type errors introduced by the migration
- **FR-007**: All component variants and sizes currently used across dashboard pages MUST remain available after migration (via the library or documented workaround)
- **FR-008**: All components MUST use the full Supabase design-system API — the custom DS `Button` (with `type=` variants, built-in loading state, and icon slots) for buttons, and Supabase's library versions of all other primitives (Input, Select, Dialog, Badge, Card, Tooltip, etc.). The current shadcn-style `variant=`/`size=` prop API used at call sites MUST be updated to match the library's API. No component may retain the old shadcn prop signatures after migration.

### Key Entities

- **Local primitive**: A file in `apps/web/src/components/ui/` that wraps or re-implements a UI component using `cva` + Radix/shadcn conventions — owned by supastack, updated manually
- **Library component**: A component exported from the Supabase shared UI package — owned upstream, available to consumers that depend on the package
- **Call site**: Any file in `apps/web/src/` that imports from `@/components/ui/<name>` — needs its import path updated as part of migration
- **Excluded primitive**: A local component with no library equivalent that remains a local file after migration (documented list)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero local primitive files remain for any component that has a library equivalent (measurable by file count in `apps/web/src/components/ui/`)
- **SC-002**: Zero import references to removed local primitive files remain anywhere in the codebase (measurable by grep)
- **SC-003**: All pre-migration Playwright e2e tests pass post-migration (0 new failures)
- **SC-004**: TypeScript build completes with 0 new type errors
- **SC-005**: Visual comparison of the 5 most-used components (button, input, dialog, select, badge) shows no unintended appearance changes from pre-migration baseline screenshots

## Assumptions

- The Supabase shared UI library will be made available to `apps/web` as a resolvable dependency (the mechanism — vendored source, workspace symlink, or npm package — is an implementation detail outside this spec's scope)
- Supabase's library components carry the same accessibility guarantees (focus management, keyboard navigation, ARIA attributes) as supastack's current shadcn-based primitives
- The migration covers only `apps/web` (the supastack dashboard); it does not touch per-project Studio containers, which run Supabase's own image
- The `CopyButton` composite component (`apps/web/src/components/CopyButton.tsx`) is out of scope — it composes the primitive and will be updated as a consequence of the button migration, not as a separate task
- Components the supabase library does not export (confirmed by `packages/ui/index.tsx`): `input-with-suffix`, `scroll-area`, `tabs`, `checkbox`, `label`, `switch`, `tooltip` — these remain local unless the library adds them

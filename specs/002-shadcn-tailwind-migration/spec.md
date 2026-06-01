# Feature Specification: Shadcn + Tailwind UI Migration

**Feature Branch**: `002-shadcn-tailwind-migration`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "migrate to make sure all ui components are shadcn based and get rid of apps/web/src/theme/components/ looks like we are using in line style which needs to be converted to tailwind"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Existing pages keep working with a unified component system (Priority: P1)

A user signs in and uses the Supastack dashboard exactly as before: lists projects, creates a project, opens a project detail page, manages backups, edits org settings, invites members, mints tokens, reviews the audit log. They notice no functional regressions but the screens feel more polished and visually consistent. The whole frontend is now built from a single component library with predictable interactions (focus states, keyboard navigation, hover transitions, disabled states) and a single styling system.

**Why this priority**: This is the only outcome that delivers value end-to-end. Until every existing page uses the new system, the codebase is in a worse state than before (two styling paradigms living side by side). A user must see no regressions and a developer must encounter no inline color/spacing hardcoded into pages.

**Independent Test**: Walk every authenticated route (`/`, `/instances/new`, `/p/:ref`, `/p/:ref/backups`, `/settings/org`, `/settings/members`, `/settings/tokens`, `/settings/audit`) plus public routes (`/login`, `/setup`, `/accept-invite`). Verify each visually matches the current design (buttons, inputs, cards, tables, status pills). Run `grep "style={{" apps/web/src` and confirm zero hits remain for color/spacing/typography values.

**Acceptance Scenarios**:

1. **Given** the user is on the Projects dashboard, **When** they view a project card, **Then** the card uses the shared component primitive and applies its hover/focus states consistently with every other card in the app.
2. **Given** the user opens the Create Project form, **When** they tab through fields, **Then** each field renders with the same input primitive used on every other form (Login, Setup, Settings).
3. **Given** the user opens a credentials reveal modal on a project detail page, **When** they trigger it, **Then** the dialog renders with the shared dialog primitive (accessible, focus-trapped, ESC-dismissable) rather than a custom one.
4. **Given** a developer searches the source for inline color values (`#171717`, `#3ECF8E`, `rgb(...)`, etc.), **When** they grep, **Then** zero results are found in `apps/web/src/pages/*` and `apps/web/src/components/*`.

---

### User Story 2 — Vendored Supabase Studio component tree is removed (Priority: P2)

A developer joining the project explores `apps/web/src/` and finds a clean, minimal source tree. There is no longer a large vendored `theme/components/` directory containing hundreds of unused Supabase Studio components (`AssistantChat/`, `Banners/`, `Chart/`, `CodeBlock/`, `Dialogs/`, etc.) that would mislead them about which components are actually live.

**Why this priority**: The vendored tree is dead code that bloats the repo, confuses code search, and triggers false matches in dependency audits. It must be removed AFTER live pages stop depending on it (which they don't today — but the deletion verifies that). This is independent value but lower priority than the P1 migration because it's purely cleanup.

**Independent Test**: After the migration, `apps/web/src/theme/components/` no longer exists. `grep -r "from .*theme/components" apps/web/src` returns zero hits. The web bundle builds, typechecks, and the running app renders all pages without errors.

**Acceptance Scenarios**:

1. **Given** the dead component directory has been deleted, **When** the developer runs the typecheck and build, **Then** both succeed with zero errors.
2. **Given** a user navigates every page, **When** they exercise every feature, **Then** the app behaves identically to before the deletion.

---

### User Story 3 — Adding new UI is fast and consistent (Priority: P3)

A developer needs to add a new settings sub-page or a new section to an existing page. They pick a primitive from the component library (Button, Input, Card, Dialog, Select, Table, Badge, Tabs, Tooltip, DropdownMenu, Form, Toast), drop it into JSX, and apply utility classes for any one-off spacing. They do not hand-roll inline styles, they do not invent new color tokens, and they do not introduce a third styling paradigm.

**Why this priority**: This is the long-term productivity outcome. It only manifests after P1 and P2 land, and it's evaluated qualitatively over many future PRs rather than in a single test. It's the reason the migration is worth doing at all.

**Independent Test**: Pick one small future task (e.g., "add a Danger Zone card to org settings with a Delete Organization button that opens a confirm dialog"). Time how long it takes a developer to add it using only the new component library and Tailwind classes. It should require zero new style files, zero new color values, and only the existing primitives.

**Acceptance Scenarios**:

1. **Given** a developer wants to add a new button to the dashboard, **When** they reach for the shared Button primitive, **Then** they get every variant they need (primary, secondary, ghost, link, destructive) with sizes (default, sm, lg, icon) without authoring any new CSS.
2. **Given** a developer wants to add a new color (e.g., a "warning" tint), **When** they add it, **Then** they extend the design tokens centrally — not inline in a component.

---

### Edge Cases

- **What happens to one-off styling that doesn't fit a primitive?** Use utility classes from the styling system, not inline `style={}` objects. If a pattern repeats more than twice, promote it to a primitive or a documented composite component.
- **What happens to the focus ring color the existing app sets via a global CSS in `index.html`?** It is migrated into the design tokens and applied consistently by primitives (focus-visible ring matching the brand green).
- **What happens when a primitive's behavior differs from the current hand-rolled equivalent?** Behavior parity wins over visual parity. If the new dialog primitive traps focus and the old one didn't, that's an improvement, not a regression.
- **What happens to inline icons that are currently hand-rolled SVGs?** They are replaced with a single icon library so all icons share stroke weight, size, and color conventions.
- **What happens during the migration to in-flight pages?** Pages are migrated incrementally; each PR can carry one or more pages, but the build must stay green after every PR.
- **Dark mode**: The app is dark-mode-only today. The new component library must respect that without introducing an unused light-mode code path.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every authenticated and public page in the web app MUST render using the new component primitives. No page may continue to use inline `style={}` objects for color, spacing, typography, border, radius, or shadow values.
- **FR-002**: Buttons across the app MUST render through a single shared primitive that exposes the variants used by the app (primary, secondary, ghost, link, destructive) and the sizes used by the app (default, small, large, icon-only).
- **FR-003**: Form inputs (text, password, email, number, search, select, textarea, checkbox, radio) MUST render through shared input primitives with consistent height, focus ring, disabled state, and validation-error styling.
- **FR-004**: Tables (Members, Tokens, Audit, Backup history) MUST render through a shared Table primitive with consistent header / cell padding, divider treatment, and empty-state behavior.
- **FR-005**: Modal/dialog surfaces (credentials reveal re-auth, delete-instance confirmation, future flows) MUST render through a shared Dialog primitive with focus-trap, ESC-to-close, and a click-outside-to-dismiss behavior.
- **FR-006**: Status pills (instance status: running, paused, provisioning, stopped, failed, deleting; backup status: completed, failed, running) MUST render through a shared Badge primitive whose color tints are sourced from design tokens.
- **FR-007**: The top navigation, page header, and content card patterns from the dashboard MUST be exposed as reusable composites and consumed by every page.
- **FR-008**: All hand-rolled inline SVG icons MUST be replaced with icons from a single shared icon library; arbitrary inline SVG remains acceptable only for the brand logomark.
- **FR-009**: A single set of design tokens (colors, font family, font sizes, line heights, font weights, radii, spacing scale, focus ring) MUST be defined once and consumed by every primitive. No primitive may hardcode a color, radius, or font size.
- **FR-010**: The dead vendored Supabase Studio component tree at `apps/web/src/theme/components/` MUST be removed after the migration completes. No file under `apps/web/src` may reference any module from inside that path after removal.
- **FR-011**: After the migration, `grep` for inline color literals (`#171717`, `#1f1f1f`, `#3ECF8E`, `rgb(`, `rgba(`) in `apps/web/src/pages/` and `apps/web/src/components/` MUST return zero results.
- **FR-012**: The web app's TypeScript typecheck, build, and existing tests MUST pass after every page-level migration step, not just at the end.
- **FR-013**: Routes (URLs, navigation, query params, links) MUST remain stable. No URL changes are introduced by the visual migration.
- **FR-014**: Existing functional behavior MUST be preserved exactly. Every form still submits to the same endpoint, every mutation still invalidates the same query keys, every guard (RequireAuth, SetupGate, role check) still gates the same routes.
- **FR-015**: Page load performance MUST not regress noticeably. The migrated bundle should not grow beyond a reasonable budget for an SPA dashboard of this size.

### Key Entities

This feature has no new data model. It is a pure UI refactor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After migration, a developer can build a new page using only existing primitives and utility classes, with zero inline color or spacing values in the new file.
- **SC-002**: Every page in the app renders with consistent typography (single font family), spacing scale, focus ring color, hover transition timing, and disabled state appearance.
- **SC-003**: The number of distinct color values used in the source drops to the tokens defined centrally. A code search for raw hex/rgb literals in `apps/web/src/pages/` and `apps/web/src/components/` returns zero results.
- **SC-004**: The directory `apps/web/src/theme/components/` no longer exists and no imports anywhere in the codebase reference paths inside it.
- **SC-005**: Every form keeps working: a user can log in, complete setup, create a project, reveal credentials, change org name, invite a member, mint a token, view the audit log, and trigger a backup — all without any functional regression.
- **SC-006**: Keyboard-only users can complete the same tasks. Each form is tab-navigable, each dialog traps focus, ESC dismisses dialogs, and the focus-visible ring is visible on every interactive element.
- **SC-007**: The web bundle size after migration stays within a documented budget (no more than ~20% increase relative to the pre-migration bundle), and the icon library is tree-shaken so unused icons do not ship.
- **SC-008**: New pages can be assembled by composing primitives without writing CSS files. The first new page added after the migration must demonstrate this.

## Assumptions

- **Single component library + single styling system.** The accepted implementation choice (named in the user's request) is shadcn-style component primitives layered on Tailwind utility classes, with Radix UI providing accessibility behavior under the hood. This is treated as a settled decision, not a question.
- **Tailwind version.** Tailwind v4 is already in `apps/web/package.json` as a beta devDependency. The migration adopts whatever stable Tailwind version is current; if v4 is still beta-only when the work lands, v3 may be substituted without changing the spec.
- **Icon library.** `lucide-react` (the icon library shadcn examples use) is the assumed default. If another icon library is chosen during implementation, it must still meet the "single library, tree-shaken" criterion in FR-008.
- **Dark mode only.** The app is dark-mode-only. Light-mode code paths are not introduced.
- **Theme token source.** The existing tokens at `apps/web/src/lib/theme.ts` are the starting point. They are translated into Tailwind theme configuration / CSS variables and the original `theme.ts` module is then removed in favor of the new source of truth.
- **Migration cadence.** The work is incremental. Each commit migrates one or more pages, and the build stays green throughout. There is no flag day where the whole app moves at once.
- **No design redesign.** This migration preserves the current visual design — it changes how the UI is built, not what it looks like. The Supabase-dashboard-parity work that already shipped remains the visual target.
- **Public route parity.** `/login`, `/setup`, `/accept-invite` are included in scope even though they are not under `RequireAuth`.
- **Tests.** The current tests pass through this migration. New component-level tests are not in scope (they can be added later); the safety net during migration is typecheck + manual walkthrough + the existing e2e/contract tests.

## Out of Scope

- Adding new features, pages, or routes.
- Changing the visual design (colors, layout proportions, hierarchy).
- Adding light mode.
- Introducing a CSS-in-JS library (styled-components, emotion, vanilla-extract, etc.) — the chosen system is utility-class-based.
- Component-level unit tests for the new primitives (defer to follow-up).
- Storybook or any component playground (defer to follow-up).
- Migrating backend / api / worker / shared packages — this is a frontend-only refactor.
- Wholesale rewrite of routing, auth, or data-fetching code paths.

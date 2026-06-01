---
description: "Task list for the Shadcn + Tailwind UI migration"
---

# Tasks: Shadcn + Tailwind UI Migration

**Input**: Design documents from `/specs/002-shadcn-tailwind-migration/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [contracts/primitives.md](./contracts/primitives.md), [quickstart.md](./quickstart.md)

**Tests**: No test tasks generated. The spec defines verification via grep guards + manual walkthrough (quickstart.md). Component-level unit tests are explicitly Out of Scope.

**Organization**: Tasks are grouped by user story. Phase 1 (Setup) and Phase 2 (Foundational primitives) MUST complete before any user-story phase begins. US1 is the MVP; US2 + US3 build on it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: Which user story this task belongs to. Setup / Foundational / Polish tasks have no story label.
- Each task description names the exact file paths it touches.

## Path Conventions

All paths are relative to repository root (`/Users/lord/Code/superbase/`). The migration touches only `apps/web/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies, wire Tailwind v4, drop CSS variables, set up shadcn CLI. After this phase, Tailwind utility classes work in any TSX file while existing inline styles continue rendering unchanged.

- [X] T001 Capture pre-migration bundle size baseline (run `docker exec supastack-web-1 sh -c 'cat /srv/assets/index-*.js | wc -c' > /tmp/web-baseline-size.txt`) and record the value in `specs/002-shadcn-tailwind-migration/research.md` (append at bottom) for the SC-007 ≤20% growth gate.
- [X] T002 Bump and add deps in `apps/web/package.json`: bump `tailwindcss` and `@tailwindcss/vite` from `^4.0.0-beta.4` to the current GA `^4` release; add `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`. Run `pnpm install` to refresh the lockfile.
- [X] T003 Wire the Tailwind plugin in `apps/web/vite.config.ts`: import `tailwindcss` from `@tailwindcss/vite` and add it to the `plugins` array. Also add a `resolve.alias` entry mapping `@` to `./src` (shadcn assumes this alias).
- [X] T004 Add the matching `@/*` path alias in `apps/web/tsconfig.json` under `compilerOptions.paths` so TypeScript and the IDE resolve `@/components/ui/button` correctly.
- [X] T005 [P] Create `apps/web/src/lib/utils.ts` exporting `cn(...args: ClassValue[])` using `clsx` + `tailwind-merge` per research.md Decision 4.
- [X] T006 Create `apps/web/src/index.css` with `@import "tailwindcss";` at the top, then the full `@theme { … }` block of color/font/radius CSS variables per the research.md token mapping (Decision 6), then a `@layer base { … }` block with the body/font/focus-visible styles currently inline in `apps/web/index.html`.
- [X] T007 Update `apps/web/src/main.tsx` to `import './index.css'` at the top of the file so Tailwind ships in the bundle.
- [X] T008 Update `apps/web/index.html`: set `<html lang="en" class="dark">`, remove the entire inline `<style>…</style>` block (moved to `index.css` in T006), and keep the Inter Google Fonts `<link>` tags.
- [X] T009 [P] Create `apps/web/components.json` with the shadcn CLI configuration from research.md Decision 2 (`style: "new-york"`, `baseColor: "slate"`, `cssVariables: true`, alias `@/components`).
- [X] T010 [P] Create `apps/web/scripts/check-inline-styles.sh` containing the two grep guards from research.md Decision 9 (`grep -E 'style=\{\{[^}]*#[0-9a-fA-F]'` and `grep 'from .*theme/components'`), both with `! …` so a match exits non-zero. Make it executable (`chmod +x`).
- [X] T011 Verify the foundation: run `pnpm --filter @supastack/web typecheck && pnpm --filter @supastack/web build`, deploy to the VM (`rsync` + `docker compose build --no-cache web && up -d web`), then visit `http://148.113.1.164/login` and confirm the existing inline-style design still renders pixel-identically. **Gate**: zero typecheck errors, zero visual regression.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Generate every shadcn primitive the migration will consume. No primitive is wired into a page yet; this phase only adds files under `apps/web/src/components/ui/`. After this phase, every primitive is available for import.

- [X] T012 [P] Generate `apps/web/src/components/ui/button.tsx` via `pnpm dlx shadcn@latest add button` (run from `apps/web/`).
- [X] T013 [P] Generate `apps/web/src/components/ui/input.tsx` via `shadcn add input`.
- [X] T014 [P] Generate `apps/web/src/components/ui/label.tsx` via `shadcn add label`.
- [X] T015 [P] Generate `apps/web/src/components/ui/textarea.tsx` via `shadcn add textarea`.
- [X] T016 [P] Generate `apps/web/src/components/ui/select.tsx` via `shadcn add select`.
- [X] T017 [P] Generate `apps/web/src/components/ui/checkbox.tsx` via `shadcn add checkbox`.
- [X] T018 [P] Generate `apps/web/src/components/ui/radio-group.tsx` via `shadcn add radio-group`.
- [X] T019 [P] Generate `apps/web/src/components/ui/dialog.tsx` via `shadcn add dialog`.
- [X] T020 [P] Generate `apps/web/src/components/ui/dropdown-menu.tsx` via `shadcn add dropdown-menu`.
- [X] T021 [P] Generate `apps/web/src/components/ui/table.tsx` via `shadcn add table`.
- [X] T022 [P] Generate `apps/web/src/components/ui/badge.tsx` via `shadcn add badge`.
- [X] T023 [P] Generate `apps/web/src/components/ui/card.tsx` via `shadcn add card`.
- [X] T024 [P] Generate `apps/web/src/components/ui/tabs.tsx` via `shadcn add tabs`.
- [X] T025 [P] Generate `apps/web/src/components/ui/tooltip.tsx` via `shadcn add tooltip`.
- [X] T026 [P] Generate `apps/web/src/components/ui/{toast,toaster}.tsx` + `apps/web/src/hooks/use-toast.ts` via `shadcn add toast`.
- [X] T027 [P] Generate `apps/web/src/components/ui/separator.tsx` via `shadcn add separator`.
- [X] T028 [P] Generate `apps/web/src/components/ui/alert.tsx` via `shadcn add alert`.
- [X] T029 [P] Generate `apps/web/src/components/ui/scroll-area.tsx` via `shadcn add scroll-area`.
- [X] T030 Customize `apps/web/src/components/ui/button.tsx`: tweak the default size to match the existing 34–36px buttons (`h-9 px-4`), keep `sm` and `lg` shadcn defaults, ensure `variant="destructive"` uses the `--color-destructive-bg` + `--color-destructive` tokens defined in `index.css`.
- [X] T031 Extend `apps/web/src/components/ui/badge.tsx` variants: add `success`, `warn`, `info` cva entries on top of the shadcn-default `default`, `secondary`, `outline`, `destructive`. The visual contract is per contracts/primitives.md (uppercase, monospace, 10–11px, dashed border on neutral statuses).
- [X] T032 Extend `apps/web/src/components/ui/alert.tsx` variants: add `warn` (yellow tints) and `info` (blue tints) on top of the shadcn-default `default` and `destructive`.
- [X] T033 Mount the global `<Toaster />` in `apps/web/src/App.tsx`: import from `@/components/ui/toaster` and render once at the root level after `<Routes>`.
- [X] T034 Verify foundation: `pnpm --filter @supastack/web typecheck && build`. The bundle now includes shadcn primitives but no page consumes them yet — the existing inline-style design still renders identically. **Gate**: zero typecheck errors, build succeeds, visual parity preserved.

---

## Phase 3: User Story 1 — Existing pages keep working with a unified component system (Priority: P1) 🎯 MVP

**Story Goal**: Every authenticated and public page renders through the new component primitives. No page uses inline `style={}` objects for color, spacing, typography, border, radius, or shadow values.

**Independent Test**: Walk every route (`/login`, `/setup`, `/accept-invite`, `/`, `/instances/new`, `/p/:ref`, `/p/:ref/backups`, `/settings/{org,members,tokens,audit}`). Visual parity with pre-migration. `bash apps/web/scripts/check-inline-styles.sh` exits 0.

### Composites (consumed by every page)

- [X] T035 [US1] Rewrite `apps/web/src/components/Shell.tsx` using `@/components/ui/*` + Tailwind utility classes. Preserves the public API `<Shell wide?>{children}</Shell>` so no page imports change. Drops the exported `ui` style preset object (`ui.input`, `ui.buttonPrimary`, etc.) — pages will switch to `<Input>` / `<Button>` directly. Top nav uses `<Button variant="ghost">` for the active-tab look.
- [X] T036 [P] [US1] Extract `apps/web/src/components/PageHeader.tsx` from the current Shell.tsx export. Public API stays `<PageHeader title subtitle? right?>`. Use `text-3xl font-normal tracking-tight` instead of inline-style font size.
- [X] T037 [P] [US1] Create `apps/web/src/components/StatusPill.tsx` wrapping `<Badge variant={…}>` with a status→variant mapping for `running` (success), `paused` (info), `provisioning` (warn), `stopped`/`deleting` (outline), `failed` (destructive), `completed` (success). Replaces the 3 hand-rolled `StatusPill`/`statusStyle` copies in Instances, InstanceDetail, InstanceBackups.
- [X] T038 [P] [US1] Create `apps/web/src/components/CopyButton.tsx` wrapping `<Button variant="ghost" size="sm">` with the secure-context-fallback clipboard logic from the current `Setup.tsx`. Shows "Copied ✓" feedback for 1.5s, optionally fires a toast.
- [X] T039 [P] [US1] Migrate `apps/web/src/components/SetupGate.tsx` — replace the `display: none` inline-style fallback with a Tailwind utility. Behavior unchanged.

### Pages (alphabetical within parallel group — each is an independent file, fully parallelizable after composites land)

- [X] T040 [US1] Migrate `apps/web/src/pages/Setup.tsx` to use `<Card>`, `<Input>`, `<Label>`, `<Button>`, `<Alert variant="destructive">`, `<CopyButton>` for the master-token panel, and lucide icons (`Wordmark` brand logomark stays as inline SVG per FR-008). All four sub-steps (`admin`, `token`, `apex-enter`, `apex-verify`) keep their existing state machine and behavior.
- [X] T041 [P] [US1] Migrate `apps/web/src/pages/Login.tsx` to use `<Card>`, `<Input>`, `<Label>`, `<Button>`, `<Alert variant="destructive">`. Drop the inline `<style>` for the form layout in favor of Tailwind classes.
- [X] T042 [P] [US1] Migrate `apps/web/src/pages/AcceptInvite.tsx` to use `<Card>`, `<Input type="password" minLength={8}>`, `<Button>`, `<Alert>`. Keep the 8-char minimum (the global password floor, already wired).
- [X] T043 [P] [US1] Migrate `apps/web/src/pages/Instances.tsx`: replace the hand-rolled toolbar with `<Input>` (search, with `lucide:Search` icon prefix), `<Select>` (status filter with dashed-border styling preserved), `<Button variant="ghost" size="icon">` × 2 for the grid/list view toggle, `<Button>` for "+ New project". Replace all 7 hand-rolled inline-SVG icons (`SearchIcon`, `SortIcon`, `PlusIcon`, `GridIcon`, `ListIcon`, `DotsIcon`, `BoxPlusIcon`) with `lucide-react` imports. Project cards use `<Card>` + `<StatusPill>` + `<DropdownMenu>` on the ⋮ menu (wire to Pause/Restart/Delete actions for a bonus UX win).
- [X] T044 [P] [US1] Migrate `apps/web/src/pages/InstancesNew.tsx` to use `<Card>` with `<Separator>`-divided rows, `<Input>`, `<Label>`, `<Button variant="link">` for "Generate a password", `<Button>` with `lucide:Eye`/`EyeOff` icons for show/hide toggle, `<Alert variant="destructive">` for errors. Preserve the 8-char minimum and the alphanumeric-only generator.
- [X] T045 [P] [US1] Migrate `apps/web/src/pages/InstanceDetail.tsx`: page header with `<StatusPill>`, three `<Card>` sections (URLs / Credentials / Lifecycle), `<Dialog>` (replaces the hand-rolled `<Modal>`) for re-auth on credentials reveal, `<Alert variant="destructive">` for `provisionError`, `<Button variant="destructive">` for Delete with a confirmation `<Dialog>` (replaces `window.confirm`). Replace the bespoke `Reveal` rows with a small composite that uses `<Input readonly>` + `<CopyButton>`.
- [X] T046 [P] [US1] Migrate `apps/web/src/pages/InstanceBackups.tsx`: `<Card>` sections (Schedule / Backup history), `<Checkbox>` for daily auto-backup, `<Input type="number">` for retention, `<Button>` for Save and Create backup, `<Table>` (with shadcn `<TableHeader>`/`<TableRow>`/`<TableHead>`/`<TableCell>`) for backup history, `<Badge variant>` for backup status pills.
- [X] T047 [P] [US1] Migrate `apps/web/src/pages/SettingsOrg.tsx`: `<Card>` sections (Identity / Backup store), `<Input>` + `<Label>` for form fields, `<RadioGroup>` for local/S3 backup-store toggle (replacing the bare `<input type="radio">`), `<Button>`, `<Alert>` for save feedback.
- [X] T048 [P] [US1] Migrate `apps/web/src/pages/SettingsMembers.tsx`: `<Card>` sections, `<Input>` + `<Select>` (role picker — Member/Admin) for invite form, `<Table>` for Open invites and Members tables, `<Alert>` for invite-link reveal, `<Button>` everywhere, `<Dialog>` for the Remove-member confirmation (replacing `window.confirm`).
- [X] T049 [P] [US1] Migrate `apps/web/src/pages/SettingsTokens.tsx`: `<Card>` sections (Create token / Your tokens), `<Input>` + `<Label>` for the label field, `<Alert variant="warn">` for the "shown once" notice, `<CopyButton>` for the freshly-minted token, `<Table>` for the existing-tokens list, `<Button variant="link">` for Revoke actions.
- [X] T050 [P] [US1] Migrate `apps/web/src/pages/SettingsAudit.tsx`: `<Card padding={0}>` containing a `<Table>`, with the `action` column rendered as `<Badge variant="outline">` (monospace, small) and the `payload` column as a `<code>` block.

### Verify Story 1

- [X] T051 [US1] Run quickstart.md sections 1–9 end-to-end on the VM after deploy. Every flow must complete with zero functional regression and visual parity (with improvements from Radix accessibility being acceptable wins).
- [X] T052 [US1] Run `bash apps/web/scripts/check-inline-styles.sh` from repo root — must exit 0 (zero hex-in-style hits, zero `theme/components` imports). FR-011 gate.

**Checkpoint**: At this point, every page renders through shadcn primitives and Tailwind classes. The MVP slice is delivered. US2 (cleanup) and US3 (docs) build on this.

---

## Phase 4: User Story 2 — Vendored Supabase Studio component tree is removed (Priority: P2)

**Story Goal**: `apps/web/src/theme/components/` no longer exists; no file under `apps/web/src` imports from inside it.

**Independent Test**: `[ ! -d apps/web/src/theme/components ]` and `! grep -rn 'from .*theme/components' apps/web/src`.

- [X] T053 [US2] Run a final verification that NO live file imports from the dead tree: `grep -rn "from ['\"].*theme/components" apps/web/src apps/web/index.html` — must return zero hits. Also check for require paths and dynamic imports.
- [X] T054 [US2] Delete `apps/web/src/theme/` entire directory (`rm -rf apps/web/src/theme`) — this includes `theme/components/`, `theme/tailwind/`, and `theme/README.md`.
- [X] T055 [US2] Delete `apps/web/src/lib/theme.ts` — tokens now live in `apps/web/src/index.css`. No file may import it post-migration; verify with `! grep -rn "from .*lib/theme" apps/web/src`.
- [X] T056 [US2] Rerun `pnpm --filter @supastack/web typecheck && build`, deploy, walk every page from quickstart.md sections 2–7. **Gate**: builds succeed and zero visual or behavioral regression.

---

## Phase 5: User Story 3 — Adding new UI is fast and consistent (Priority: P3)

**Story Goal**: Document the primitive set so the next developer knows where to reach. Make the convention discoverable.

**Independent Test**: A new developer reading `apps/web/src/components/ui/README.md` can identify which primitive to use for any common UI need without reading source files.

- [X] T057 [US3] Create `apps/web/src/components/ui/README.md` listing every primitive with a one-line description, its props/variants (matching contracts/primitives.md), an import example, and a "Conventions" section that documents: (a) always use `cn()` from `@/lib/utils` for className composition, (b) variants live in `cva` configs co-located with each primitive, (c) tokens are CSS variables defined in `apps/web/src/index.css` — extend there, never inline, (d) icons come from `lucide-react` exclusively except for the brand logomark.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: CI guards, bundle budget verification, accessibility sanity, final walkthrough.

- [X] T058 Wire the inline-style + dead-tree grep guard into the repo's pre-commit / CI runner so a regression fails the build immediately. Concretely: add a `.specify/extensions/git/scripts/bash/pre-commit-ui-guard.sh` entry or extend an existing CI script to invoke `apps/web/scripts/check-inline-styles.sh`.
- [X] T059 Capture post-migration bundle size on the VM (`docker exec supastack-web-1 sh -c 'cat /srv/assets/index-*.js | wc -c'`) and compare with the T001 baseline. **Gate**: growth ≤ 20% (SC-007). If over budget, lazy-load Dialog/DropdownMenu/Select per-route via `React.lazy` and recapture.
- [X] T060 Open the Projects dashboard in Chrome DevTools, run Lighthouse + the axe DevTools accessibility audit. **Gate**: zero serious or critical accessibility violations; perf score ≥ 85.
- [X] T061 Final keyboard-only walkthrough per quickstart.md section 9: unplug the mouse, drive every flow using Tab / Shift+Tab / Enter / Space / Escape / arrows only. Every interactive element reachable, focus-visible ring on every focused element, dialogs trap focus, ESC dismisses.
- [X] T062 Update the project's main `plan.md` (root) to note the new frontend stack (Tailwind v4 + shadcn-ui), so future contributors don't re-derive it.

---

## Dependencies

```text
Setup (T001 → T011)
  └── Foundational (T012 → T034)   [primitives are [P] within phase]
        └── US1 Composites (T035 → T039)   [T036–T039 are [P] after T035]
              └── US1 Pages (T040 → T050)  [T041–T050 are [P]; T040 first since it exercises the most primitives]
                    └── US1 Verify (T051, T052)
                          └── US2 Cleanup (T053 → T056)
                                └── US3 Docs (T057)
                                      └── Polish (T058 → T062)
```

### Why this order

- **Setup before Foundational**: `pnpm dlx shadcn add` won't work without `components.json`, the path alias, and the `index.css` with token variables. T001 is just baseline capture and is technically [P] with all of Setup, but it costs nothing to do it first.
- **Foundational before US1**: every composite (Shell, PageHeader, StatusPill, CopyButton) imports from `@/components/ui/*`. Those primitive files must exist before any composite TSX file typechecks.
- **Composites before pages**: every page imports `<Shell>` and `<PageHeader>`. The page TSX won't compile if the composite props or location move underneath them.
- **T040 before T041–T050**: Setup.tsx exercises the largest variety of primitives (Card, Input, Label, Button × 3 variants, Alert, CopyButton, plus the apex-verify polling). Migrating it first validates the primitive customization (T030–T032) under real load. The other 10 pages are then [P] because they touch independent files.
- **US1 Verify before US2 Cleanup**: must prove the live app works on shadcn before deleting fallbacks.
- **US2 before US3**: the docs (T057) describe the final state. Writing them before cleanup risks documenting a path that still has dead code referenced.

---

## Parallel execution examples

After T034 (foundation gate passes), the entire Foundational phase's `[P]` tasks run together:

```text
# 18 shadcn primitive installs, all [P]:
T012  T013  T014  T015  T016  T017  T018  T019  T020
T021  T022  T023  T024  T025  T026  T027  T028  T029
```

After T035 (Shell rewrite lands), the rest of the composites and most pages parallelize:

```text
# Composites [P] (T036–T039) — all independent files
T036  T037  T038  T039

# Pages [P] (T041–T050) — all independent files
T041  T042  T043  T044  T045  T046  T047  T048  T049  T050
```

T040 (Setup.tsx) is **NOT** marked `[P]` with the rest because it acts as the canary for the customized primitives (T030–T032). If T040 reveals that a Button size or Badge variant needs tweaking, the fix lands once and the parallel pages all benefit.

---

## Implementation strategy

### MVP scope (deliver first)

**User Story 1 only** (T001 → T052). At the end of T052, the entire app is rendering through shadcn + Tailwind. This is a shippable, demoable state — every page works, no functional regressions, design parity preserved. The vendored tree (`apps/web/src/theme/components/`) is dead code that still exists on disk but is unreachable; the inline-style `theme.ts` is also still there as fallback. Both are deleted in Phase 4.

### Incremental delivery

The migration is naturally PR-shaped:

1. **PR 1**: Phase 1 (T001–T011). Infrastructure change only, zero UI diff. Easy to review.
2. **PR 2**: Phase 2 (T012–T034). Adds 18 primitive files; no page imports them yet. Reviewable per file.
3. **PR 3**: T035–T039 (composites). Visible polish on Shell chrome only.
4. **PR 4**: T040 (Setup.tsx). The canary. Validates customizations.
5. **PRs 5–14** (one per page): T041–T050. Each is a self-contained page migration.
6. **PR 15**: T051–T052 (verify) + T053–T056 (cleanup — delete dead tree, delete theme.ts).
7. **PR 16**: T057 (docs).
8. **PR 17**: T058–T062 (polish — CI guards, bundle check, a11y audit, final walkthrough).

Total: ~17 PRs, but the 10 page migrations (PRs 5–14) can land in parallel because they touch independent files.

### Risk reduction

- **Bundle bloat**: gated at T059. Lazy-load Dialog/DropdownMenu/Select per-route if needed.
- **Visual regression**: every page-level task has a manual walkthrough step. Pre-migration screenshots in `~/.claude/image-cache/` are the reference.
- **shadcn CLI surprises**: each `shadcn add` is its own commit, so a bad generation rolls back cleanly.
- **Tailwind v4 friction**: if Decision 1's contingency fires, swap to v3 stable at T002 — only `tailwind.config.ts` shape changes, the rest of the migration is identical.

---

## Format validation

All tasks above follow the strict checklist format: `- [ ]` + task ID + `[P]` (where applicable) + `[Story]` (only inside story phases) + description + file path. Spot-check:

- ✅ `- [ ] T001 Capture pre-migration bundle size baseline … in specs/002-shadcn-tailwind-migration/research.md` (Setup, no story label, file path present)
- ✅ `- [ ] T012 [P] Generate apps/web/src/components/ui/button.tsx via pnpm dlx shadcn@latest add button` (Foundational, [P], file path present, no story label)
- ✅ `- [ ] T040 [US1] Migrate apps/web/src/pages/Setup.tsx …` (Story task, US1 label, file path present, not [P] by design)
- ✅ `- [ ] T053 [US2] Run a final verification …` (Story task, US2 label, file paths in description)
- ✅ `- [ ] T058 Wire the inline-style + dead-tree grep guard …` (Polish, no story label, file paths in description)

All 62 tasks pass the format check.

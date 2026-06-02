# Tasks: Migrate UI Primitives to Supabase Design System

**Input**: Design documents from `specs/084-migrate-ui-primitives/`

**Branch**: `084-migrate-ui-primitives`

**Format**: `[ID] [P?] [Story?] Description with file path`
- **[P]**: Can run in parallel with other [P] tasks in the same phase
- **[US#]**: User story from spec.md this task serves

---

## Phase 1: Setup

**Purpose**: Establish source reference for vendoring

- [ ] T001 Confirm source commit: read `infra/supabase-template/COMMIT` and verify `/Users/lord/Code/supabase/supabase` is checked out at that commit (or note the commit SHA for manual diff); document the SHA in `specs/084-migrate-ui-primitives/research.md` under "Pinned commit"

---

## Phase 2: Foundational — CSS Token System

**Purpose**: Replace supastack's shadcn `@theme {}` token layer with Supabase's semantic token system. All vendored components depend on Supabase token names (`bg-brand-400`, `text-foreground-muted`, `border-control`, etc.) — this phase is a hard prerequisite for all subsequent phases.

**⚠️ CRITICAL**: No component vendoring can begin until this phase is complete and the build passes.

- [ ] T002 Audit `apps/web/src/index.css`: list every CSS variable in the `@theme {}` block that is referenced by name in `.tsx` files outside `components/ui/` (run `grep -rn "bg-primary\|text-muted-foreground\|border-border\|text-foreground-light\|bg-muted\|bg-secondary\|bg-accent\|bg-destructive\|bg-success\|bg-warn\|bg-info\|ring-ring" apps/web/src --include="*.tsx" --include="*.ts"` and record the hits)
- [ ] T003 Rewrite the `@theme {}` block in `apps/web/src/index.css` with Supabase's semantic dark-mode tokens: add all `--brand-*` (200–600 + default), `--destructive-*`, `--warning-*` scales; add all `--border-*`, `--background-*`, `--foreground-*` semantic tokens per the mapping table in `specs/084-migrate-ui-primitives/data-model.md`; retain local overrides for `--ring`, `--info`, and radius tokens (`--radius-sm/md/lg/xl`) which have no Supabase equivalent
- [ ] T004 Update every non-`components/ui/` `.tsx` file found in T002 that uses old shadcn token classes: replace with Supabase equivalents per data-model.md token mapping table (e.g. `bg-primary` → `bg-brand-400`, `text-muted-foreground` → `text-foreground-muted`, `border-border` → `border-default`, `bg-destructive` → `bg-destructive`)
- [ ] T005 Update token class references inside the two excluded component files: `apps/web/src/components/ui/sonner.tsx` and `apps/web/src/components/ui/input-with-suffix.tsx` — replace any old `--color-*` variable or shadcn token class with the new Supabase equivalents
- [ ] T006 Verify: run `pnpm --filter @supastack/web build`; confirm zero TypeScript errors and zero Tailwind "unknown utility" warnings; open the dashboard dev server and visually confirm pages render with correct dark palette (no blown-out colours, no invisible text)

**Checkpoint**: Build passes. Tailwind resolves `bg-brand-400`, `text-foreground-muted`, `border-control` etc. Dashboard looks visually equivalent to pre-migration.

---

## Phase 3: User Story 1 — Button Migration (Priority: P1) 🎯 MVP

**Goal**: Replace supastack's shadcn `<Button>` with the full Supabase DS Button; update all 33 call sites to the `type=` / renamed-size API. Developers gain loading states, icon slots, and the Supabase brand button appearance.

**Independent Test**: Import `{ Button }` from `@/components/ui/button` in any file; render `<Button type="primary">Save</Button>` and `<Button type="danger" loading>Deleting…</Button>`; both render correctly with Supabase brand styling and the spinner.

- [ ] T007 [US1] Copy `Button.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/Button/Button.tsx` into `apps/web/src/components/ui/button.tsx` (replacing the existing file)
- [ ] T008 [US1] Copy `Button.module.css` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/Button/Button.module.css` into `apps/web/src/components/ui/button.module.css`
- [ ] T009 [US1] Create `apps/web/src/components/ui/constants.ts` with the `SIZE_VARIANTS` and `SIZE_VARIANTS_DEFAULT` exports copied from `/Users/lord/Code/supabase/supabase/packages/ui/src/lib/constants.ts`
- [ ] T010 [US1] Fix all internal imports in the vendored `apps/web/src/components/ui/button.tsx`: `cn` → `@/lib/utils`, `SIZE_VARIANTS` → `./constants`, `cva`/`VariantProps` from `class-variance-authority`, `Loader2` from `lucide-react`, `Slot` from `radix-ui`; remove any relative paths that pointed into packages/ui internals
- [ ] T011 [US1] Update `apps/web/src/components/CopyButton.tsx`: replace `variant="outline" size="xs"` with `type="outline" size="tiny"`; verify the copy-icon `iconLeft` prop if applicable
- [ ] T012 [US1] Update all Button call sites in `apps/web/src/` (33 files) — run `grep -rln "from '@/components/ui/button'" apps/web/src --include="*.tsx"` to get the full list, then apply these mechanical renames in every file: `variant="default"` → `type="primary"`, `variant="secondary"` → `type="default"`, `variant="outline"` → `type="outline"`, `variant="ghost"` → `type="text"`, `variant="link"` → `type="link"`, `variant="destructive"` → `type="danger"`; `size="xs"` → `size="tiny"`, `size="sm"` → `size="small"`, `size="lg"` → `size="large"`, `size="icon"` / `size="icon-xs"` / `size="icon-sm"` / `size="icon-lg"` → appropriate `size="tiny/small/large"` + explicit `className="w-[26px]"` or equivalent; any `<button type="submit">` rendered via asChild → move to `htmlType="submit"`
- [ ] T013 [US1] Run `pnpm --filter @supastack/web typecheck`; fix any remaining type errors from the Button migration (common: missing `type=` prop where `variant=` was omitted and defaulted, `htmlType` vs `type` conflicts)

**Checkpoint**: TypeScript passes. All button-bearing pages render Supabase DS buttons. `<Button type="primary" loading>` shows spinner.

---

## Phase 4: User Story 1 — Shadcn Component Bulk Migration (Priority: P1)

**Goal**: Replace the remaining 17 local primitive files with vendored copies from `packages/ui/src/components/shadcn/ui/`. These are largely drop-in replacements — same Radix-based prop API, only token references change (already handled by Phase 2).

**Independent Test**: Build passes; all forms and dialogs in the dashboard render without errors; `pnpm --filter @supastack/web typecheck` passes.

### High-attention components (API or export differences)

- [ ] T014 [P] [US1] Vendor `apps/web/src/components/ui/input.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/input.tsx`; fix internal imports (cn → `@/lib/utils`, SIZE_VARIANTS → `./constants`); the new Input gains an optional `size=` prop — existing call sites without `size=` continue to work (default is `"small"`)
- [ ] T015 [P] [US1] Vendor `apps/web/src/components/ui/badge.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/badge.tsx`; compare exported variant names against current call sites (`grep -rn "variant=" apps/web/src --include="*.tsx" | grep badge`) and update any variant names that changed
- [ ] T016 [P] [US1] Vendor `apps/web/src/components/ui/card.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/card.tsx`; check if any call site uses `CardAction` (grep for it) — if found, replace with a plain `<div>` wrapper since `CardAction` does not exist in the Supabase version

### Drop-in shadcn components (no API changes expected)

- [ ] T017 [P] [US1] Vendor `apps/web/src/components/ui/alert.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/alert.tsx`; fix cn import
- [ ] T018 [P] [US1] Vendor `apps/web/src/components/ui/dialog.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/dialog.tsx`; fix cn + Radix imports
- [ ] T019 [P] [US1] Vendor `apps/web/src/components/ui/sheet.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/sheet.tsx`; fix imports
- [ ] T020 [P] [US1] Vendor `apps/web/src/components/ui/select.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/select.tsx`; fix imports
- [ ] T021 [P] [US1] Vendor `apps/web/src/components/ui/dropdown-menu.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/dropdown-menu.tsx`; fix imports
- [ ] T022 [P] [US1] Vendor `apps/web/src/components/ui/separator.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/separator.tsx`; fix imports
- [ ] T023 [P] [US1] Vendor `apps/web/src/components/ui/checkbox.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/checkbox.tsx`; fix imports
- [ ] T024 [P] [US1] Vendor `apps/web/src/components/ui/radio-group.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/radio-group.tsx`; fix imports
- [ ] T025 [P] [US1] Vendor `apps/web/src/components/ui/switch.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/switch.tsx`; fix imports
- [ ] T026 [P] [US1] Vendor `apps/web/src/components/ui/textarea.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/textarea.tsx`; fix imports
- [ ] T027 [P] [US1] Vendor `apps/web/src/components/ui/tabs.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/tabs.tsx`; the upstream file re-exports as `Tabs_Shadcn_` — in the vendored copy, change the export names back to `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` to match current supastack call sites
- [ ] T028 [P] [US1] Vendor `apps/web/src/components/ui/tooltip.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/tooltip.tsx`; fix imports
- [ ] T029 [P] [US1] Vendor `apps/web/src/components/ui/label.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/label.tsx`; fix imports
- [ ] T030 [P] [US1] Vendor `apps/web/src/components/ui/scroll-area.tsx` from `/Users/lord/Code/supabase/supabase/packages/ui/src/components/shadcn/ui/scroll-area.tsx`; fix imports
- [ ] T031 [US1] Run `pnpm --filter @supastack/web typecheck` after all T014–T030 are complete; fix any type errors from shadcn component vendoring (likely: changed prop types, missing sub-component exports)

**Checkpoint**: TypeScript passes. All 18 component files are vendored. No call sites needed updating for non-Button components.

---

## Phase 5: User Story 2 — Excluded Component Updates (Priority: P2)

**Goal**: Update `input-with-suffix` and `sonner` to compose the newly-vendored `Input` and use the new token system. Visual consistency of the dashboard is now complete.

**Independent Test**: Load any page using `<InputWithSuffix>` (e.g. secrets page) and any page with toast notifications; both render correctly with Supabase token-based styling.

- [ ] T032 [P] [US2] Update `apps/web/src/components/ui/input-with-suffix.tsx`: replace internal composition with the newly-vendored `Input` (import from `./input`); pass the `size` prop through to the underlying Input; ensure the suffix slot renders alongside the Input correctly
- [ ] T033 [P] [US2] Review `apps/web/src/components/ui/sonner.tsx` for any hardcoded colour values or old token class names missed in T005; update to Supabase token equivalents; verify `<Toaster>` renders with correct dark-theme styling

**Checkpoint**: InputWithSuffix and toast render correctly. Visual consistency with Supabase Studio achieved.

---

## Phase 6: User Story 3 — Regression Verification (Priority: P3)

**Goal**: Confirm zero regressions. All existing Playwright e2e tests pass; TypeScript build is clean.

**Independent Test**: Full `pnpm --filter @supastack/web test:e2e` run returns 0 failures.

- [ ] T034 [US3] Run the full Playwright e2e suite: `pnpm --filter @supastack/web test:e2e`; capture output; list any failing tests
- [ ] T035 [US3] For each failing test from T034: determine if the failure is a genuine regression (component broke) or a stale selector (test asserted on old class/attribute names like `data-variant="default"` that changed to `data-type="primary"`); fix stale selectors; if genuine regression, fix the component
- [ ] T036 [US3] Run `pnpm --filter @supastack/web build` for a final production build check; confirm zero errors and zero warnings
- [ ] T037 [US3] Visual spot-check: load these 5 key pages in the dashboard dev server and confirm no layout regressions: `/dashboard` (overview), `/dashboard/project/:ref/auth/providers` (drawer-heavy), `/dashboard/project/:ref/secrets` (InputWithSuffix), `/dashboard/settings/tokens` (table + badge), `/dashboard/project/:ref/auth/hooks` (form with Button variants); compare against pre-migration screenshots if available

**Checkpoint**: Zero new Playwright failures. Build clean. Visual spot-check passes.

---

## Phase 7: Polish

- [ ] T038 [P] Update `apps/web/src/components/ui/README.md`: revise the primitives table to reflect vendored sources (column: "Source" pointing to packages/ui path), remove the "Customize freely — we own them" note for vendored components, add a "Vendoring" section explaining the pinned commit process
- [ ] T039 [P] Update `specs/084-migrate-ui-primitives/research.md` with the actual pinned commit SHA confirmed in T001
- [ ] T040 Commit all changes with message: `feat(web): migrate UI primitives to Supabase design system (084)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Token system)**: Depends on Phase 1 — **BLOCKS phases 3–6**
- **Phase 3 (Button)**: Depends on Phase 2 completion
- **Phase 4 (Shadcn bulk)**: Depends on Phase 2 completion — can run in parallel with Phase 3 (different files)
- **Phase 5 (Excluded components)**: Depends on Phase 4 (uses vendored Input)
- **Phase 6 (Verification)**: Depends on phases 3–5 complete
- **Phase 7 (Polish)**: Depends on Phase 6

### User Story Dependencies

- **US1 (P1)**: Phases 2–4 — foundation + bulk migration
- **US2 (P2)**: Phase 5 — excluded component updates; can start after Phase 4 Input is vendored (T014)
- **US3 (P3)**: Phase 6 — verification after all implementation complete

### Within Each Phase

- All tasks marked [P] within a phase can run in parallel
- Phase 4 tasks T014–T030 are all independently parallelizable (different files)
- T031 must wait for T014–T030

---

## Parallel Execution Examples

### Phase 4 — all 17 shadcn components in parallel

```
T014 vendor input.tsx
T015 vendor badge.tsx        ← all can run simultaneously
T016 vendor card.tsx
T017 vendor alert.tsx
T018 vendor dialog.tsx
T019 vendor sheet.tsx
T020 vendor select.tsx
T021 vendor dropdown-menu.tsx
T022 vendor separator.tsx
T023 vendor checkbox.tsx
T024 vendor radio-group.tsx
T025 vendor switch.tsx
T026 vendor textarea.tsx
T027 vendor tabs.tsx
T028 vendor tooltip.tsx
T029 vendor label.tsx
T030 vendor scroll-area.tsx
→ T031 typecheck (after all above)
```

### Phase 3 + Phase 4 in parallel (different files)

```
Phase 3: T007 → T008 → T009 → T010 → T011 → T012 → T013 (Button files)
Phase 4: T014–T030 in parallel (shadcn files)
```

Both phases only require Phase 2 complete; they touch different files.

---

## Implementation Strategy

### MVP (US1 only — phases 1–4)

1. Phase 1: Confirm source commit
2. Phase 2: Token system rewrite (prerequisite)
3. Phase 3: Button migration
4. Phase 4: Shadcn bulk migration
5. **STOP**: Run `pnpm typecheck` + visual spot-check → US1 delivered

### Full delivery

1. MVP above
2. Phase 5: Update excluded components → US2 delivered
3. Phase 6: Playwright verification → US3 delivered
4. Phase 7: Polish + commit

---

## Notes

- Source files are at `/Users/lord/Code/supabase/supabase/packages/ui/` — always read from there, not npm
- When copying component files, fix ALL relative imports before testing; most failures come from unresolved `../../lib/utils` paths
- The Tabs component is re-exported as `Tabs_Shadcn_` upstream — always rename back to `Tabs` in the vendored copy
- Button's `type=` prop replaces `variant=` AND conflicts with HTML's `type` attribute for form submission — use `htmlType=` for submit/reset/button
- `input-with-suffix` and `sonner` are intentionally excluded from vendoring; update them in Phase 5 only

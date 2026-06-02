# Quickstart: UI Primitive Migration

## Overview

This migration replaces supastack's 18 local shadcn-based UI primitives with vendored copies of Supabase's `packages/ui` components, and migrates the CSS token system from shadcn conventions to Supabase's semantic token system.

The migration is broken into 4 sequential user stories. Each story is independently deployable and testable.

---

## US1 — CSS Token System Migration (prerequisite for all others)

**Goal**: Replace `apps/web/src/index.css` `@theme {}` block with Supabase's token system. After this step, all Tailwind utility classes used by vendored components (`bg-brand-400`, `text-foreground-muted`, `border-control`, etc.) resolve correctly.

**Steps**:
1. Get Supabase's dark theme token values from `packages/ui/build/css/themes/dark.css` (or `packages/ui/src/styles/` — check for a dark mode CSS file at the pinned commit)
2. Rewrite the `@theme {}` block in `apps/web/src/index.css`:
   - Add all `--brand-*`, `--destructive-*`, `--warning-*` scale tokens
   - Add all `--border-*`, `--background-*`, `--foreground-*` semantic tokens (see data-model.md)
   - Retain local overrides for tokens with no Supabase equivalent: `--ring`, `--info`, radius tokens
3. Update any dashboard pages/components that reference old token class names directly (e.g. `bg-primary` → `bg-brand-400`, `text-muted-foreground` → `text-foreground-muted`)
4. Verify: `pnpm --filter @supastack/web build` succeeds; dashboard pages render with correct dark theme

**Verification**: Open the dashboard in dev mode. All current pages should look visually equivalent to pre-migration (same dark palette, spacing, etc.).

---

## US2 — Button Migration

**Goal**: Replace `apps/web/src/components/ui/button.tsx` with the Supabase DS Button and update all 33 call sites.

**Steps**:
1. Copy `packages/ui/src/components/Button/Button.tsx` and `Button.module.css` into `apps/web/src/components/ui/`
2. Copy `packages/ui/src/lib/constants.ts` (SIZE_VARIANTS) to `apps/web/src/components/ui/constants.ts`
3. Verify the vendored Button imports (`cn`, `cva`, `Slot`, etc.) resolve correctly in the new location; update relative import paths
4. Find all 33 files in `apps/web/src/` importing from `@/components/ui/button` and update:
   - `variant="default"` → `type="primary"`
   - `variant="secondary"` → `type="default"`
   - `variant="outline"` → `type="outline"`
   - `variant="ghost"` → `type="text"`
   - `variant="link"` → `type="link"`
   - `variant="destructive"` → `type="danger"`
   - `size="xs"` → `size="tiny"`
   - `size="sm"` → `size="small"`
   - `size="lg"` → `size="large"`
   - Icon-only `size="icon*"` → `size="tiny/small/large"` + explicit width class
   - HTML `type="submit"` → `htmlType="submit"` (move to new prop)
5. Update `apps/web/src/components/CopyButton.tsx` (composes Button)
6. Delete old `apps/web/src/components/ui/button.tsx` (after confirming no remaining references)

**Verification**: `pnpm --filter @supastack/web typecheck` passes; all button-bearing pages render correctly; all Playwright button interaction tests pass.

---

## US3 — Shadcn Component Migration (bulk)

**Goal**: Replace the remaining 17 local primitives with vendored copies from `packages/ui/src/components/shadcn/ui/`. These are largely drop-in replacements — import paths stay the same, prop APIs are compatible.

**Components**: Input, Alert, Badge, Card, Dialog, Sheet, DropdownMenu, Select, Separator, Checkbox, RadioGroup, Switch, Textarea, Tabs, Tooltip, Label, ScrollArea

**Steps**:
1. For each component, copy `packages/ui/src/components/shadcn/ui/<name>.tsx` to `apps/web/src/components/ui/<name>.tsx` (replacing the existing file)
2. Fix any relative import paths inside each copied file (cn, utils, Radix primitives)
3. For `tabs.tsx`: the upstream file re-exports as `Tabs_Shadcn_`; in the vendored copy, export as `Tabs` (the supastack convention)
4. Verify `CardAction` usage: if any dashboard page uses `CardAction`, replace with the appropriate Supabase equivalent or remove
5. For `input.tsx`: no call sites need updating (size prop is additive/optional), but `input-with-suffix.tsx` should be updated to pass `size` through

**Verification**: `pnpm --filter @supastack/web typecheck` passes; full Playwright suite passes.

---

## US4 — Excluded Component Updates

**Goal**: Update `input-with-suffix.tsx` and `sonner.tsx` to compose/reference the new token system.

**Steps**:
1. `input-with-suffix.tsx`: Update internal composition to use the vendored `Input` component; pass `size` prop through to the underlying Input
2. `sonner.tsx`: Replace any hardcoded color references or old token class names with new Supabase token equivalents

**Verification**: Any pages using `InputWithSuffix` or toast notifications render and behave correctly.

---

## US5 — Regression Verification

**Goal**: Full Playwright e2e suite passes with zero new failures.

**Steps**:
1. Run `pnpm --filter @supastack/web test:e2e` from the repo root
2. Address any test failures caused by:
   - Changed button `data-variant` attributes (if tests assert on these)
   - Changed class names on rendered elements (if tests use class-based selectors)
   - Visual changes caught by screenshot comparisons
3. Update test selectors if they relied on old class/attribute names (not behaviour regressions — only selector updates)

---

## Source Commit Reference

Always vendor from the commit pinned in `infra/supabase-template/COMMIT`:
```bash
COMMIT=$(cat infra/supabase-template/COMMIT)
# Copy from: /Users/lord/Code/supabase/supabase at commit $COMMIT
# (or use git show $COMMIT:packages/ui/src/components/... to read at exact commit)
```

This keeps the dashboard primitives in sync with the Studio image.

# Implementation Plan: Shadcn + Tailwind UI Migration

**Branch**: `002-shadcn-tailwind-migration` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-shadcn-tailwind-migration/spec.md`

## Summary

Migrate the entire `apps/web` frontend from inline-`style` objects and a typed-tokens module to a Tailwind-utility-class codebase with shadcn-style component primitives sitting on top of Radix UI. Translate the current `apps/web/src/lib/theme.ts` tokens into Tailwind v4's CSS-first `@theme` configuration so the existing visual design is preserved 1:1. Migrate 11 pages incrementally, keeping the build green between PRs. After every page is converted, delete the vendored Supabase Studio component tree at `apps/web/src/theme/components/` (hundreds of files, currently zero imports). End state: a single component library, a single styling system, design tokens centralized in CSS variables, and zero raw color/spacing literals in page source.

## Technical Context

**Language/Version**: TypeScript 5.6, React 18.3

**Primary Dependencies**:
- Existing: `vite@5`, `react@18.3`, `react-router-dom@6`, `@tanstack/react-query@5`, `axios`
- Adopt stable: `tailwindcss@4` (currently pinned to `4.0.0-beta.4` — bump to GA), `@tailwindcss/vite@4`
- New: `lucide-react` (icons), `class-variance-authority` (variant API for primitives), `clsx` + `tailwind-merge` (class composition helper), `tailwindcss-animate` (Radix animation keyframes)
- New (transitive via shadcn-copied components): `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-label`, `@radix-ui/react-select`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `@radix-ui/react-checkbox`, `@radix-ui/react-radio-group`, `@radix-ui/react-toast`, `@radix-ui/react-separator`

**Storage**: N/A — pure UI refactor

**Testing**: `vitest` (existing). Visual parity validated by manual walkthrough of the 11 routes. Build + typecheck (`tsc --noEmit`) run after every page-level migration step (FR-012).

**Target Platform**: Modern evergreen browsers (Chrome/Edge/Safari/Firefox latest 2 versions). The deployed bundle is served by Caddy from the `selfbase-web` container.

**Project Type**: SPA dashboard (single Vite-built React app), single-package within a pnpm workspace.

**Performance Goals**: Bundle size growth ≤ 20% vs. pre-migration baseline (FR-015 / SC-007). Time-to-interactive on the Projects dashboard stays in the same ballpark (~1s on a warm cache).

**Constraints**:
- Dark-mode only — no light-mode code paths.
- No URL/route changes (FR-013).
- Build stays green after every page migration (FR-012).
- Behavior parity is non-negotiable; visual parity is the target but improvements from upgrading to accessible Radix primitives (focus-trap, keyboard nav) are acceptable as wins.

**Scale/Scope**: 11 pages, ~2.5k lines of TSX, ~20 shadcn primitives, 1 shared `Shell` composite. Estimated 1500–2500 line diff once converted to utility classes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project's `.specify/memory/constitution.md` is still a placeholder template (no principles ratified). There are therefore no constitutional gates to evaluate for this migration. The relevant repo-level guidance is the existing user CLAUDE.md / RULES.md (no comments unless asked, idempotent migrations, no `$` in passwords, etc.) — none of which conflict with this refactor.

**Status**: ✅ No gate violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/002-shadcn-tailwind-migration/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output (Tailwind v4 vs v3, shadcn install mechanics, token mapping)
├── contracts/
│   └── primitives.md    # UI contract: list of shadcn primitives + their props/variants/sizes
├── quickstart.md        # Phase 1 output: end-to-end manual verification script
└── checklists/
    └── requirements.md  # Spec quality checklist (already created)
```

### Source code (this feature touches only `apps/web`)

```text
apps/web/
├── src/
│   ├── components/
│   │   ├── ui/                          # NEW — shadcn primitives copied via CLI
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── textarea.tsx
│   │   │   ├── select.tsx
│   │   │   ├── checkbox.tsx
│   │   │   ├── radio-group.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── table.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── card.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── tooltip.tsx
│   │   │   ├── toast.tsx + toaster.tsx + use-toast.ts
│   │   │   ├── separator.tsx
│   │   │   ├── alert.tsx
│   │   │   └── scroll-area.tsx
│   │   ├── Shell.tsx                    # REWRITTEN to use ui/* primitives
│   │   ├── SetupGate.tsx                # touched — but unchanged in behavior
│   │   ├── StatusPill.tsx               # NEW — instance/backup status badge wrapper
│   │   ├── PageHeader.tsx               # NEW — extracted from current Shell.tsx
│   │   └── CopyButton.tsx               # NEW — extracted from Setup.tsx
│   ├── lib/
│   │   ├── utils.ts                     # NEW — `cn()` (clsx + tailwind-merge), shared by every primitive
│   │   ├── api.ts                       # unchanged
│   │   ├── auth-context.tsx             # unchanged
│   │   └── theme.ts                     # DELETED after migration (tokens move into CSS vars)
│   ├── pages/                           # ALL 11 PAGES REWRITTEN (utility classes, no inline style)
│   │   ├── Login.tsx
│   │   ├── Setup.tsx
│   │   ├── AcceptInvite.tsx
│   │   ├── Instances.tsx
│   │   ├── InstancesNew.tsx
│   │   ├── InstanceDetail.tsx
│   │   ├── InstanceBackups.tsx
│   │   ├── SettingsOrg.tsx
│   │   ├── SettingsMembers.tsx
│   │   ├── SettingsTokens.tsx
│   │   └── SettingsAudit.tsx
│   ├── theme/                           # ENTIRE DIRECTORY DELETED after migration
│   │   ├── components/                  # vendored Supabase Studio tree (currently 0 imports)
│   │   ├── tailwind/                    # vendored Supabase Tailwind config (currently unused)
│   │   └── README.md
│   ├── index.css                        # NEW — Tailwind directives + @theme block + base styles
│   ├── main.tsx                         # touched — import index.css and render Toaster
│   └── App.tsx                          # touched — wrap with <Toaster /> for shadcn toasts
├── index.html                           # touched — remove the inline <style> font/focus block
├── tailwind.config.ts                   # NEW (v4 needs minimal JS config; most config lives in CSS @theme)
├── components.json                      # NEW — shadcn CLI config (paths, style, baseColor, css vars)
└── vite.config.ts                       # touched — register `@tailwindcss/vite` plugin
```

**Structure Decision**: The migration lives entirely inside `apps/web/`. No changes to `apps/api`, `apps/worker`, `packages/*`, or `infra/*`. The new `components/ui/` directory holds shadcn primitives (per shadcn convention — copied into the repo, not imported from npm). The existing `components/Shell.tsx`, `SetupGate.tsx`, and friends remain at `components/*` (one level up) since they are composites built ON TOP of `ui/*`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitutional violations.

| Risk | Mitigation |
|------|-----------|
| Tailwind v4 ecosystem tooling may lag (IDE plugins, PostCSS interop) | If v4 is rough on contact, fall back to v3 stable. Spec is version-agnostic; see `research.md`. |
| shadcn CLI may overwrite already-customized components | We commit between each `shadcn add <component>` so diffs are reviewable. CLI uses `--overwrite` only with confirmation. |
| Bundle growth from Radix transitive deps | Tree-shaking + per-component lazy imports for heavy primitives. Budget enforced in SC-007. |
| Inline styles drift back during the migration window | After each page migrates, a `grep` guard (`grep -E 'style=\{\{[^}]*#[0-9a-fA-F]'`) fails the build if a regression slips in. |

---

## Phase 0 — Research (artifact: `research.md`)

See `research.md` for the full write-up. Key decisions resolved there:

- **Tailwind v4 GA** with the `@tailwindcss/vite` plugin. Fallback to v3 only if a blocker appears during install.
- **shadcn CLI** in `new-york` style, `slate` base color, with CSS variables enabled.
- **`lucide-react`** as the single icon library (replaces ~7 hand-rolled SVGs).
- **`class-variance-authority`** for primitive variants (shadcn convention).
- **CSS-variable token strategy**: every `theme.ts` color → CSS custom property + Tailwind `@theme` entry. Pages reference them via Tailwind utilities (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, etc.).
- **Dark-mode only**: skip the light-mode CSS variable block; set `:root { color-scheme: dark; }` and define dark colors on `:root` directly.
- **Migration order**: tokens + primitives first; then `Shell` composite; then pages in priority order.

---

## Phase 1 — Design & Contracts

### Data model

This feature has no data model. **Skipped.**

### Contracts

Single contract: **the set of UI primitives and their public APIs**. See `contracts/primitives.md` for the full list with per-primitive props, variants, and sizes. The contract is enforced at the TypeScript level — every primitive's exported props type is the contract.

Other "contracts" affected:
- **No HTTP contracts change.** All API URLs, request bodies, and response shapes remain identical (FR-013, FR-014).
- **No routing contract changes.** Every existing route + redirect is preserved.

### Token-to-CSS-variable mapping

This is the heart of the migration. Full table lives in `research.md`. It is implemented in `apps/web/src/index.css`. Tokens to migrate from `lib/theme.ts`:

| `theme.ts` token | CSS variable | Tailwind utility |
|---|---|---|
| `color.pageBg` (`#171717`) | `--background` | `bg-background` |
| `color.text` (`#fafafa`) | `--foreground` | `text-foreground` |
| `color.cardBg` (`#1f1f1f`) | `--card` | `bg-card` |
| `color.border` (`#393939`) | `--border` | `border-border` |
| `color.borderSoft` (`#2a2a2a`) | `--border-soft` | `border-border-soft` |
| `color.textMuted` (`#898989`) | `--muted-foreground` | `text-muted-foreground` |
| `color.textLight` (`#b4b4b4`) | `--foreground-light` | `text-foreground-light` |
| `color.brandBg` (`#006239`) | `--primary` | `bg-primary` |
| `color.brandBorder` (`rgba(62,207,142,0.3)`) | `--primary-border` | `border-primary/30` |
| `color.success` (`#3ECF8E`) | `--success` | `text-success`, `bg-success/10` |
| `color.danger` (`#f87171`) | `--destructive` | `text-destructive` |
| `color.dangerBg` (`#3a1717`) | `--destructive-bg` | `bg-destructive-bg` |
| `color.warn` (`#fadc6b`) | `--warn` | `text-warn` |
| `color.info` (`#7ab8f5`) | `--info` | `text-info` |
| `color.secondaryBg` (`#242424`) | `--secondary` | `bg-secondary` |
| `color.inputBg` (`rgba(255,255,255,0.026)`) | `--input` | `bg-input` |
| `font.family` (Circular…Inter…) | `--font-sans` | `font-sans` |
| `radius.{sm,md,lg}` (4/6/8) | `--radius-sm/md/lg` | `rounded-sm/md/lg` |

### Agent context update

After `/speckit-plan` completes, `CLAUDE.md` at the project root is updated so the SPECKIT block points to `specs/002-shadcn-tailwind-migration/plan.md` (replacing the previous `001-…` reference).

### Quickstart

See `quickstart.md` for the end-to-end manual verification script that walks every page after the migration completes.

---

## Migration order (informs `/speckit-tasks`)

A high-level sequence — full task list is generated by `/speckit-tasks`:

1. **Infrastructure** (no user-visible change)
   - Wire `@tailwindcss/vite` into `vite.config.ts`.
   - Create `apps/web/src/index.css` with `@import "tailwindcss"`, `@theme { … }` block of CSS variables (per the token table above), and base layer styles (body bg, font stack, focus-visible ring).
   - Create `tailwind.config.ts` (minimal — content paths only, since v4 uses CSS-first config).
   - Add `lib/utils.ts` exporting `cn()`.
   - Create `components.json` for shadcn CLI.
   - Install: `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate` + Radix peer deps shadcn pulls in.
   - **Gate**: web builds, typechecks, and the app still renders with old inline styles (Tailwind co-exists).

2. **Primitives** (no user-visible change)
   - Run `pnpm dlx shadcn@latest add button input label textarea select checkbox radio-group dialog dropdown-menu table badge card tabs tooltip toast separator alert scroll-area` inside `apps/web`.
   - Review the generated files. Adjust default sizes/variants to match our spacing (34px buttons, 32px chips) where shadcn defaults differ.
   - Add `<Toaster />` to `App.tsx`.
   - **Gate**: web still renders identically. Primitives exist but no page imports them yet.

3. **Composites** (no user-visible change, except hairline polish)
   - Rewrite `components/Shell.tsx` using `ui/*` primitives + Tailwind utility classes.
   - Extract `PageHeader.tsx` from the current Shell.
   - New `components/StatusPill.tsx` — wraps `ui/badge` with the status-tint logic.
   - New `components/CopyButton.tsx` — wraps `ui/button` + the secure-context fallback already in Setup.tsx.
   - **Gate**: Projects dashboard renders identically (same chrome, same heading, same toolbar).

4. **Page migration** — one page per task, in this order:
   - `Setup.tsx` (largest, most interactive — gets the most value from primitives)
   - `Login.tsx` (smallest)
   - `AcceptInvite.tsx`
   - `Instances.tsx`
   - `InstancesNew.tsx`
   - `InstanceDetail.tsx`
   - `InstanceBackups.tsx`
   - `SettingsOrg.tsx`
   - `SettingsMembers.tsx`
   - `SettingsTokens.tsx`
   - `SettingsAudit.tsx`
   - **Gate per task**: typecheck + build pass; manual walkthrough confirms parity.

5. **Cleanup**
   - Delete `apps/web/src/theme/` (entire vendored directory).
   - Delete `apps/web/src/lib/theme.ts` (replaced by CSS variables).
   - Strip the inline `<style>` block from `apps/web/index.html` (moves to `index.css`).
   - Add a CI guard: a `grep` check that fails if any `style={{` literal contains a color hex.
   - **Gate**: zero hits on the grep guard. Bundle size compared to baseline. Final manual walkthrough.

---

## Re-check Constitution post-design

No constitution to re-check. ✅

---

## Stop & report

This `/speckit-plan` invocation ends here. Next step is `/speckit-tasks` to generate the per-step task list with file paths and dependencies.

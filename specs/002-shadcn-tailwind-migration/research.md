# Research: Shadcn + Tailwind UI Migration

**Feature**: 002-shadcn-tailwind-migration · **Phase**: 0 · **Date**: 2026-05-22

This document resolves the unknowns in the plan's Technical Context and records the rationale for the implementation choices.

---

## Decision 1 — Tailwind version

**Decision**: Tailwind CSS v4 (GA) via the `@tailwindcss/vite` plugin.

**Rationale**:
- Already pinned in `apps/web/package.json` (`tailwindcss@^4.0.0-beta.4`, `@tailwindcss/vite@^4.0.0-beta.4`); bumping to the GA release rather than going backward is the lower-friction move.
- v4 is CSS-first: tokens live in CSS via `@theme { … }` blocks instead of a `tailwind.config.ts` JS object. That maps cleanly onto our existing `theme.ts` token shape and lets us colocate tokens with the CSS files that consume them.
- The Vite plugin replaces the PostCSS+autoprefixer chain — fewer moving parts in `vite.config.ts`.
- shadcn officially supports v4 (the `shadcn@latest` CLI emits v4-compatible components by default in 2026).

**Alternatives considered**:
- **Tailwind v3 stable**: more mature ecosystem and IDE tooling. Rejected as the default because v4 is already in `package.json` and the migration is the right moment to pay the upgrade cost. Kept as a contingency — if v4 produces blockers (e.g. an IDE plugin can't resolve `@theme` tokens), the spec is version-agnostic and we drop back to v3 by swapping the install commands.
- **Skip Tailwind entirely and just adopt shadcn over plain CSS modules**: shadcn primitives assume Tailwind utilities throughout. Rejected as fighting the tool.

---

## Decision 2 — Component library mechanism

**Decision**: shadcn CLI (`pnpm dlx shadcn@latest add <component>`), components copied into `apps/web/src/components/ui/` and owned by us.

**Rationale**:
- Standard shadcn convention. The components are **copied**, not imported from an npm package — we can edit them directly when we need a tweak (e.g. our 34px button height vs. shadcn's 36px default).
- Each primitive declares its own variants via `class-variance-authority`, which fits our existing token-driven approach.
- We pull in only what we need (~18 primitives) — no dead code.

**CLI config (`components.json`)**:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

We use `@/` as the path alias (`vite.config.ts` resolves it to `apps/web/src/`).

**Alternatives considered**:
- **Radix UI directly**: lower-level, more boilerplate per component. shadcn already wraps Radix with our exact styling conventions.
- **Material UI / Mantine / Chakra**: each ships its own design system that fights with the Supabase look we've already built. Rejected.
- **Headless UI**: thinner than Radix and less coverage. Rejected.

---

## Decision 3 — Icon library

**Decision**: `lucide-react`.

**Rationale**:
- Same icon set the shadcn examples use. Tree-shakes by default — only the icons we import end up in the bundle.
- Consistent 24×24 viewBox, 2px stroke, rounded line caps/joins. Matches the look of the hand-rolled SVGs we've already drawn (Search, Plus, Grid, List, Dots, BoxPlus, Sort).
- Replaces 7 hand-rolled icons with 7 imports. No more bespoke `<svg>` blocks except the brand logomark.

**Alternatives considered**:
- **Phosphor**, **Heroicons**, **Tabler Icons**: all reasonable; chose lucide for the shadcn community alignment.
- **react-icons**: ships all sets; bigger surface area; rejected for tree-shake clarity.

---

## Decision 4 — Class composition helper

**Decision**: `cn()` = `twMerge(clsx(...args))`, exported from `apps/web/src/lib/utils.ts`.

**Rationale**:
- `clsx` handles conditional class strings (`clsx("a", isActive && "b")`).
- `tailwind-merge` resolves conflicts between Tailwind utility classes (`px-2` + `px-4` → `px-4`). Without it, conditional overrides applied via props on shadcn components break unpredictably.
- This is the shadcn convention; every generated primitive imports `cn` from `@/lib/utils`.

```ts
// apps/web/src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

---

## Decision 5 — Dark-mode strategy

**Decision**: Dark mode is the only mode. Apply `class="dark"` on `<html>` permanently in `index.html`. Define all color CSS variables under `.dark { … }` (or directly on `:root` since we never toggle).

**Rationale**:
- App is dark-mode-only today (every `bg`/`color` value we use is dark-theme).
- Adding a light-mode code path is explicitly out of scope (spec Out of Scope #3).
- shadcn primitives expect a `dark` class to enable dark-themed utilities. We satisfy that by hardcoding it.

**Implementation**:
```html
<!-- apps/web/index.html -->
<html lang="en" class="dark">
```

```css
/* apps/web/src/index.css */
@import "tailwindcss";

@theme {
  /* dark-only — defined directly */
  --color-background: #171717;
  --color-foreground: #fafafa;
  --color-card: #1f1f1f;
  --color-border: #393939;
  --color-border-soft: #2a2a2a;
  --color-muted-foreground: #898989;
  --color-foreground-light: #b4b4b4;
  --color-primary: #006239;
  --color-primary-foreground: #fafafa;
  --color-secondary: #242424;
  --color-secondary-foreground: #fafafa;
  --color-success: #3ecf8e;
  --color-warn: #fadc6b;
  --color-info: #7ab8f5;
  --color-destructive: #f87171;
  --color-destructive-bg: #3a1717;
  --color-input: rgba(255, 255, 255, 0.026);

  --font-sans: Circular, "Circular Std", "TT Commons Pro", Inter, ui-sans-serif,
    system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}

@layer base {
  :root { color-scheme: dark; }
  html, body, #root {
    background: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    margin: 0;
    min-height: 100vh;
  }
  *:focus-visible {
    outline: 2px solid var(--color-success);
    outline-offset: 1px;
  }
  input:focus {
    border-color: var(--color-border-soft);
    background: rgba(255, 255, 255, 0.04);
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
}
```

**Alternatives considered**:
- **Light + dark toggle**: explicitly out of scope. Adds work, ships unused CSS, complicates token names. Rejected.

---

## Decision 6 — Token mapping (full table)

This is the source-of-truth mapping from `apps/web/src/lib/theme.ts` to Tailwind utility classes. Every value in `theme.ts` either has a mapping below or is dropped (because it's no longer needed once we use Tailwind's built-in scale).

| `theme.ts` source | New CSS variable | Tailwind utility | Notes |
|---|---|---|---|
| `color.pageBg` `#171717` | `--color-background` | `bg-background` | Shadcn standard name |
| `color.text` `#fafafa` | `--color-foreground` | `text-foreground` | |
| `color.cardBg` `#1f1f1f` | `--color-card` | `bg-card` | Used by `<Card>` primitive |
| `color.border` `#393939` | `--color-border` | `border-border` | |
| `color.borderSoft` `#2a2a2a` | `--color-border-soft` | `border-border-soft` | Custom extension |
| `color.textMuted` `#898989` | `--color-muted-foreground` | `text-muted-foreground` | |
| `color.textLight` `#b4b4b4` | `--color-foreground-light` | `text-foreground-light` | Custom extension |
| `color.brandBg` `#006239` | `--color-primary` | `bg-primary` | Maps brand to shadcn's `primary` |
| `color.brandBorder` `rgba(62,207,142,0.3)` | n/a | `border-primary/30` | Use Tailwind's opacity modifier |
| `color.success` `#3ECF8E` | `--color-success` | `text-success`, `bg-success/10` | Custom extension |
| `color.danger` `#f87171` | `--color-destructive` | `text-destructive` | Shadcn standard |
| `color.dangerBg` `#3a1717` | `--color-destructive-bg` | `bg-destructive-bg` | Custom extension |
| `color.warn` `#fadc6b` | `--color-warn` | `text-warn` | Custom |
| `color.warnBg` `#3a3a17` | n/a | `bg-warn/10` | Use opacity |
| `color.info` `#7ab8f5` | `--color-info` | `text-info` | Custom |
| `color.infoBg` `#1f2a3a` | n/a | `bg-info/10` | Use opacity |
| `color.secondaryBg` `#242424` | `--color-secondary` | `bg-secondary` | Shadcn standard |
| `color.inputBg` `rgba(255,255,255,0.026)` | `--color-input` | `bg-input` | |
| `font.family` | `--font-sans` | `font-sans` | |
| `font.sizeBase` `14px` | n/a — Tailwind `text-sm` is 14px | `text-sm` | |
| `font.sizeSm` `13px` | n/a — use `text-[13px]` arbitrary value sparingly | `text-[13px]` | |
| `font.sizeXs` `12px` | n/a — Tailwind `text-xs` is 12px | `text-xs` | |
| `font.sizeHeading` `30px` | n/a — Tailwind `text-3xl` is 30px | `text-3xl` | |
| `font.sizeSubheading` `16px` | n/a — Tailwind `text-base` is 16px | `text-base` | |
| `font.weightRegular` `400` | n/a | `font-normal` | |
| `font.weightMedium` `500` | n/a | `font-medium` | |
| `radius.sm` `4px` | `--radius-sm` | `rounded-sm` | |
| `radius.md` `6px` | `--radius-md` | `rounded-md` | |
| `radius.lg` `8px` | `--radius-lg` | `rounded-lg` | |
| `radius.full` `999px` | n/a | `rounded-full` | |
| `spacing.formWidth` `384px` | n/a | `w-96` | |
| `spacing.inputHeight` `34px` | n/a | `h-[34px]` | Custom — shadcn default is `h-9` (36px) |
| `spacing.buttonHeight` `38px` | n/a | `h-9` or `h-10` | Standardize on shadcn `h-9` (36px) — close enough |
| `spacing.inputPadding` `8px 12px` | n/a | `px-3 py-2` | |
| `spacing.buttonPadding` `8px 16px` | n/a | `px-4 py-2` | |

**Removed tokens** (no longer needed after migration): the `ui.*` style preset objects (`ui.input`, `ui.buttonPrimary`, etc.) currently exported from `Shell.tsx`. Each is replaced by an `<Input>` or `<Button variant="…">` primitive.

---

## Decision 7 — Migration order rationale

Order chosen so that each step ships an independently buildable, demoable state:

1. **Tailwind + utils + components.json** — infra only, no UI change. Tailwind co-exists with inline styles for one commit.
2. **shadcn primitives** — primitives exist but not consumed. Bundle barely changes (tree-shaking).
3. **Shell + PageHeader + StatusPill + CopyButton** — composites built on primitives. Every page consumes Shell, so this one PR re-skins the chrome.
4. **Setup.tsx first** — biggest, most form-heavy. Validates the primitive set covers our real needs before we touch 10 more pages.
5. **Login/AcceptInvite** — small public pages, low-risk, builds momentum.
6. **Instances.tsx** — already structurally aligned with the new design.
7. **InstancesNew / InstanceDetail / Backups** — heavier interactive surfaces.
8. **Settings\*** — last batch; all table/form patterns that mirror earlier pages, so velocity peaks here.
9. **Cleanup** — delete dead code, add CI grep guard, compare bundle size.

Each step gates on `tsc --noEmit` + `vite build` + a manual walkthrough of the touched pages.

---

## Decision 8 — Bundle-size budget

**Baseline**: pre-migration bundle is ~`/srv/assets/index-*.js` from the currently deployed `supastack-web` image. Capture its byte size as the baseline before step 1.

**Budget**: ≤ 20% growth (SC-007). Expected additions:
- `lucide-react` icons (only the imported ones — ~1KB each gzipped)
- Radix UI primitives (~3-8KB gzipped each for Dialog/DropdownMenu/Select)
- shadcn-generated component files (smaller than current inline-style equivalents in many cases)

Removed:
- Inline `style` objects and the `theme.ts` token tree (~3KB)
- Hand-rolled SVG icons (~1-2KB)

Realistic estimate: +50-100KB gzipped. If we blow past 20%, lazy-load Dialog and DropdownMenu (the heaviest primitives) per-page.

---

## Decision 9 — CI guard against inline-style regression

After cleanup, add a tiny grep step (pre-commit hook + CI step) that fails the build if a color hex literal appears inside a `style={{ … }}` block in `apps/web/src/`:

```bash
# Returns non-zero if any inline-style with a hex color is found.
! grep -rn -E 'style=\{\{[^}]*#[0-9a-fA-F]{3,8}' apps/web/src
```

A second grep ensures the dead vendored tree stays deleted:

```bash
! grep -rn 'from .*theme/components' apps/web/src
```

Both grep checks are idempotent and run in < 1s on the existing tree.

---

## Decision 10 — Visual parity verification

**Method**: Manual walkthrough of the 11 routes after each migration step, comparing against the deployed pre-migration screenshots already in `~/.claude/image-cache/`. Differences acceptable: improvements (focus rings, focus-trap on dialogs, keyboard nav). Differences not acceptable: changed layouts, missing buttons, mis-sized hit targets, regressions in dark theme contrast.

**Tooling**: For higher confidence, optionally run Chrome DevTools' Lighthouse + axe-core checks once at the end. Not required to pass the spec — manual walkthrough is sufficient.

---

## All unknowns resolved

✅ Tailwind version: v4
✅ Component library: shadcn (copy via CLI)
✅ Icon library: lucide-react
✅ Class composition: cn() = twMerge + clsx
✅ Dark mode: dark-only, `class="dark"` on `<html>`
✅ Token mapping: full table above
✅ Migration order: infra → primitives → composites → pages → cleanup
✅ Bundle budget: ≤ 20% growth
✅ CI guard: grep checks
✅ Verification: manual walkthrough + screenshot diff

---

## Captured baseline (T001)

**Pre-migration bundle**: `/srv/assets/index-D7Ogluuw.js` = **313,039 bytes** raw (uncompressed) on `supastack-web` image as deployed at 2026-05-22 20:01 UTC.

20% growth budget per SC-007: **post-migration bundle ≤ 375,646 bytes** raw.

# Research: Migrate UI Primitives to Supabase Design System

## Pinned commit

`8cd39680ef7614bbb36ad4f3803c4e7446d22714` — verified present in `/Users/lord/Code/supabase/supabase`. All packages/ui component source files confirmed at this SHA.

## Decision 1: How to consume packages/ui

**Decision**: Vendor component source files directly into `apps/web/src/components/ui/`

**Rationale**: `packages/ui` is an internal workspace package (`name: "ui"`, `version: "0.0.0"`) with no `exports` field and no npm publication. It is not consumable as an external npm dependency. Vendoring (copying source files) is the same model shadcn itself uses — components are owned in-tree and updated deliberately. This gives full control over the token bridge layer and avoids monorepo coupling.

**Alternatives considered**:
- *Publish packages/ui to npm*: Requires Supabase to maintain a public release; outside supastack's control
- *Git submodule / workspace symlink*: Couples supastack's build to Supabase's monorepo toolchain (turbo, pnpm workspace); significant ops overhead
- *Copy entire packages/ui as a local package*: Brings ~170+ components and icon exports not needed; maintenance burden

**Source commit to vendor from**: Pin to the same commit as `infra/supabase-template/COMMIT` so studio image and dashboard primitives are in sync.

---

## Decision 2: Token system migration strategy

**Decision**: Replace supastack's shadcn token layer in `apps/web/src/index.css` with Supabase's semantic token system, bridged via a compatibility shim for any supastack-specific tokens that have no Supabase equivalent.

**Rationale**: The vendored components reference Supabase tokens (`bg-brand-400`, `text-foreground-light`, `border-control`, etc.) not supastack's current ones (`bg-primary`, `text-muted-foreground`, `border-border`). The token layer must be migrated first — it is a hard prerequisite for vendored components to render correctly.

**Token format change**: Supabase uses HSL `hue deg sat% light%` format. Supastack currently uses hex. The migration adopts HSL throughout.

**Token mapping** (old → new):

| Supastack token | Supabase equivalent | Notes |
|---|---|---|
| `--primary` / `bg-primary` | `--brand-default` / `bg-brand-400` | Brand green |
| `--destructive` | `--destructive-default` | Error red |
| `--background` | `--background-default` | Page bg |
| `--foreground` | `--foreground-default` | Default text |
| `--border` | `--border-default` | Default border |
| `--border-soft` | `--border-alternative` | Softer border |
| `--input` | `--background-control` | Input bg |
| `--muted` | `--background-muted` | Muted bg |
| `--muted-foreground` | `--foreground-muted` | Muted text |
| `--foreground-light` | `--foreground-lighter` | Dim text |
| `--ring` | (no direct equivalent) | Keep as local override |
| `--success` | `--brand-default` (or dedicated success token) | Supabase uses brand green for success |
| `--warn` | `--warning-default` | Warning yellow |
| `--info` | (no direct equivalent) | Keep as local override |
| `--card` | `--background-surface-100` | Card bg |
| `--popover` | `--background-overlay-default` | Popover bg |
| `--secondary` | `--background-surface-200` | Secondary bg |
| `--accent` | `--background-selection` | Hover/selection |
| `--radius-*` | Keep as-is (Supabase uses Tailwind default radii) | No Supabase token equiv |

**Supastack-only tokens to retain as local overrides**: `--info`, `--ring` (focus ring), radius tokens.

---

## Decision 3: Button API migration

**Decision**: Adopt the full Supabase DS Button (`src/components/Button/Button.tsx`) with `type=` variants, `size=` using Supabase names, `loading=`, `iconLeft=`, `iconRight=` props.

**Variant mapping** (supastack `variant=` → Supabase `type=`):

| Supastack | Supabase | Notes |
|---|---|---|
| `default` | `primary` | Primary brand action |
| `destructive` | `danger` | Destructive action |
| `outline` | `outline` | Same intent |
| `secondary` | `default` | Supabase's neutral button |
| `ghost` | `text` | No background, hover only |
| `link` | `link` | Text link style |

**Size mapping** (supastack `size=` → Supabase `size=`):

| Supastack | Supabase | Notes |
|---|---|---|
| `xs` | `tiny` | h-[26px] |
| `sm` | `small` | h-[34px] |
| `default` | `medium` | h-[38px] |
| `lg` | `large` | h-[42px] |
| `icon` | `tiny` + `icon` prop | Icon-only buttons |
| `icon-xs` | `tiny` + `icon` | |
| `icon-sm` | `small` + `icon` | |
| `icon-lg` | `large` + `icon` | |

**Gained capabilities**: `loading={true}` shows built-in spinner (no need to compose manually); `iconLeft` / `iconRight` for icon+text buttons; `block` for full-width; `rounded` for pill shape; `htmlType` for submit/button/reset (frees `type=` for visual variant).

**Migration impact**: 33 files importing Button in `apps/web/src/`.

---

## Decision 4: Non-Button component migration strategy

**Decision**: For all other components (Input, Select, Dialog, Badge, Card, DropdownMenu, Sheet, Separator, Textarea, Checkbox, Label, RadioGroup, ScrollArea, Switch, Tooltip, Alert, Tabs), vendor the `packages/ui/src/components/shadcn/ui/<name>.tsx` source files. These use the same Radix/cva pattern as supastack's current files but reference Supabase tokens.

**Impact**: Import paths (`@/components/ui/<name>`) remain unchanged. Prop API is largely compatible with supastack's current shadcn-based files. No call site prop changes expected except where Supabase's file exports different sub-component names.

**Tabs caveat**: packages/ui re-exports Tabs as `Tabs_Shadcn_` to avoid conflict with its own custom Tabs component. The vendored file will be imported under the original `Tabs` name (no renaming needed in the destination).

---

## Decision 5: Excluded components (remain local)

These components have no packages/ui equivalent and stay as local files:

| Component | Reason |
|---|---|
| `input-with-suffix.tsx` | Custom supastack composite; no upstream equivalent |
| `sonner.tsx` | Wrapper around `sonner` npm package; project-specific config |

`input-with-suffix.tsx` will be updated to compose the new vendored `Input` after the Input migration.

---

## Decision 6: CSS/Tailwind config migration

**Decision**: Replace supastack's Tailwind `@theme {}` block with Supabase's token definitions. Supabase uses a separate CSS file per theme (`dark.css`) consumed via `@import`. Supastack will consolidate into a single `index.css` with the dark theme as the only theme (supastack is dark-only today).

**Tailwind class usage**: Supabase components use utility classes referencing their token names (e.g. `bg-brand-400`, `text-foreground-muted`, `border-control`). Tailwind v4's `@theme` block must define these so the classes are generated. The migration adds these token definitions alongside or replacing the current ones.

# Data Model: UI Primitive Migration

## Component Inventory & Migration Map

### Migrated Components (local file → vendored from packages/ui)

| Component | Supastack file | Source in packages/ui | Call sites | API changes? |
|---|---|---|---|---|
| Button | `button.tsx` | `src/components/Button/Button.tsx` | 33 | Yes — `variant=` → `type=`, `size=` names change |
| Input | `input.tsx` | `src/components/shadcn/ui/input.tsx` | 26 | Minor — gains `size=` prop |
| Alert | `alert.tsx` | `src/components/shadcn/ui/alert.tsx` | 12 | None |
| Card | `card.tsx` | `src/components/shadcn/ui/card.tsx` | 15 | None (CardAction sub-component removed) |
| Label | `label.tsx` | `src/components/shadcn/ui/label.tsx` | 11 | None |
| Badge | `badge.tsx` | `src/components/shadcn/ui/badge.tsx` | 7 | Check variant names |
| Dialog | `dialog.tsx` | `src/components/shadcn/ui/dialog.tsx` | 7 | None |
| Sheet | `sheet.tsx` | `src/components/shadcn/ui/sheet.tsx` | 7 | None |
| DropdownMenu | `dropdown-menu.tsx` | `src/components/shadcn/ui/dropdown-menu.tsx` | 3 | None |
| Select | `select.tsx` | `src/components/shadcn/ui/select.tsx` | 3 | None |
| Separator | `separator.tsx` | `src/components/shadcn/ui/separator.tsx` | 2 | None |
| Checkbox | `checkbox.tsx` | `src/components/shadcn/ui/checkbox.tsx` | 1 | None |
| RadioGroup | `radio-group.tsx` | `src/components/shadcn/ui/radio-group.tsx` | 1 | None |
| Switch | `switch.tsx` | `src/components/shadcn/ui/switch.tsx` | 1 | None |
| Textarea | `textarea.tsx` | `src/components/shadcn/ui/textarea.tsx` | 1 | None |
| Tabs | `tabs.tsx` | `src/components/shadcn/ui/tabs.tsx` | ~1 | None (re-exported as `Tabs_Shadcn_` upstream but vendored as `Tabs` here) |
| Tooltip | `tooltip.tsx` | `src/components/shadcn/ui/tooltip.tsx` | ~3 | None |
| ScrollArea | `scroll-area.tsx` | `src/components/shadcn/ui/scroll-area.tsx` | ~1 | None |

**Total migrated**: 18 components, 136+ call sites

### Excluded Components (remain as local files)

| Component | Reason | Action |
|---|---|---|
| `input-with-suffix.tsx` | No upstream equivalent; custom composite | Update to compose new vendored `Input` |
| `sonner.tsx` | Project-specific toast config wrapper | Update token references post-CSS migration |

---

## Token Migration Map

### Full mapping: supastack `@theme {}` → Supabase token system

Supastack's current tokens are shadcn-convention. Supabase's tokens are semantic-named with multi-level scales. Both ultimately drive Tailwind utility classes.

| Supastack CSS var | Tailwind class | Supabase CSS var | Supabase Tailwind class |
|---|---|---|---|
| `--color-background` | `bg-background` | `--background-default` | `bg-background-default` |
| `--color-foreground` | `text-foreground` | `--foreground-default` | `text-foreground-default` |
| `--color-card` | `bg-card` | `--background-surface-100` | `bg-background-surface-100` |
| `--color-card-foreground` | `text-card-foreground` | `--foreground-default` | `text-foreground` |
| `--color-primary` | `bg-primary` | `--brand-default` | `bg-brand-400` |
| `--color-primary-foreground` | `text-primary-foreground` | `--foreground-default` | `text-foreground` |
| `--color-secondary` | `bg-secondary` | `--background-surface-200` | `bg-background-surface-200` |
| `--color-muted` | `bg-muted` | `--background-muted` | `bg-muted` |
| `--color-muted-foreground` | `text-muted-foreground` | `--foreground-muted` | `text-foreground-muted` |
| `--color-foreground-light` | `text-foreground-light` | `--foreground-lighter` | `text-foreground-lighter` |
| `--color-border` | `border-border` | `--border-default` | `border-default` |
| `--color-border-soft` | `border-border-soft` | `--border-alternative` | `border-alternative` |
| `--color-input` | `bg-input` | `--background-control` | `bg-background/[.026]` |
| `--color-destructive` | `bg-destructive` | `--destructive-default` | `bg-destructive` |
| `--color-success` | `bg-success` / `text-success` | `--brand-600` | `bg-brand-600` |
| `--color-warn` | `bg-warn` | `--warning-default` | `bg-warning-default` |
| `--color-accent` | `bg-accent` | `--background-selection` | `bg-selection` |
| `--color-popover` | `bg-popover` | `--background-overlay-default` | `bg-overlay` |
| `--color-ring` | `ring-ring` | (no direct equivalent) | Keep as local `--ring` override |
| `--color-info` | `bg-info` / `text-info` | (no direct equivalent) | Keep as local `--info` override |
| `--radius-sm` | `rounded-sm` | (Tailwind defaults) | `rounded` |
| `--radius-md` | `rounded-md` | (Tailwind defaults) | `rounded-md` |
| `--radius-lg` | `rounded-lg` | (Tailwind defaults) | `rounded-lg` |

### Tokens to add (Supabase-only, needed by vendored components)

These do not exist in supastack's current system and must be added:

- `--brand-*` scale (200–600 + default)
- `--destructive-*` scale (200–600 + default)
- `--warning-*` scale (200–600 + default)
- `--border-stronger`, `--border-strong`, `--border-control`, `--border-overlay`, `--border-alternative`, `--border-muted`
- `--background-surface-*` (75, 100, 200, 300, 400)
- `--background-overlay-*`, `--background-overlay-hover`
- `--background-selection`, `--background-muted`, `--background-control`
- `--background-alternative-default`
- `--background-dash-canvas`, `--background-dash-sidebar`
- `--foreground-muted`, `--foreground-lighter`, `--foreground-light`, `--foreground-contrast`

---

## Button Variant State Transitions

```
Supastack call site         →    Updated call site
─────────────────────────────────────────────────
<Button variant="default">  →  <Button type="primary">
<Button variant="secondary"> →  <Button type="default">
<Button variant="outline">   →  <Button type="outline">
<Button variant="ghost">     →  <Button type="text">
<Button variant="link">      →  <Button type="link">
<Button variant="destructive"> → <Button type="danger">

<Button size="xs">   →  <Button size="tiny">
<Button size="sm">   →  <Button size="small">
(default)            →  <Button size="medium">
<Button size="lg">   →  <Button size="large">
<Button size="icon"> →  <Button size="tiny" className="w-[26px]">
```

---

## File Structure Delta

### Files deleted after migration
```
apps/web/src/components/ui/button.tsx       ← replaced by vendored copy
apps/web/src/components/ui/input.tsx        ← replaced
apps/web/src/components/ui/alert.tsx        ← replaced
apps/web/src/components/ui/badge.tsx        ← replaced
apps/web/src/components/ui/card.tsx         ← replaced
apps/web/src/components/ui/checkbox.tsx     ← replaced
apps/web/src/components/ui/dialog.tsx       ← replaced
apps/web/src/components/ui/dropdown-menu.tsx ← replaced
apps/web/src/components/ui/label.tsx        ← replaced
apps/web/src/components/ui/radio-group.tsx  ← replaced
apps/web/src/components/ui/scroll-area.tsx  ← replaced
apps/web/src/components/ui/select.tsx       ← replaced
apps/web/src/components/ui/separator.tsx    ← replaced
apps/web/src/components/ui/sheet.tsx        ← replaced
apps/web/src/components/ui/switch.tsx       ← replaced
apps/web/src/components/ui/tabs.tsx         ← replaced
apps/web/src/components/ui/textarea.tsx     ← replaced
apps/web/src/components/ui/tooltip.tsx      ← replaced
```

### Files added after migration
```
apps/web/src/components/ui/button.tsx       ← vendored from packages/ui Button/Button.tsx
apps/web/src/components/ui/input.tsx        ← vendored from shadcn/ui/input.tsx
apps/web/src/components/ui/alert.tsx        ← vendored from shadcn/ui/alert.tsx
... (etc for each of the 18 migrated components)
apps/web/src/components/ui/constants.ts     ← SIZE_VARIANTS + SIZE_VARIANTS_DEFAULT from packages/ui/src/lib/constants
apps/web/src/lib/utils/cn.ts                ← ensure cn() util matches packages/ui's version
```

### Files modified after migration
```
apps/web/src/index.css                      ← token system rewrite
apps/web/src/components/ui/sonner.tsx       ← update token references
apps/web/src/components/ui/input-with-suffix.tsx ← compose new Input
apps/web/src/components/CopyButton.tsx      ← Button API update
[33 files] importing Button                 ← variant/size prop updates
```

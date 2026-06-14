# UI primitives

Components vendored from Supabase's `packages/ui` at commit `8cd39680ef` (pinned to match `infra/supabase-template/COMMIT`). Each file owns its variant configuration and forwards refs. Files are updated deliberately when the Supabase commit is bumped — not via shadcn CLI.

**Two categories:**

- **Vendored** — copied from `packages/ui/src/components/` with imports rewritten to resolve locally. Do not run `shadcn add` on these; re-vendor from the source instead.
- **Local** — `input-with-suffix.tsx`, `sonner.tsx` — no upstream equivalent; supastack-specific.

## Primitives

| File                | Purpose                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alert.tsx`         | Inline message banners. Variants: `default`, `destructive`, `warn`, `info`.                                                                                                                                                                                                                                                                                                                 |
| `badge.tsx`         | Small uppercase pills (status / labels). Variants: `default`, `secondary`, `outline`, `destructive`, `success`, `warn`, `info`, `ghost`, `link`. Used by `<StatusPill>`.                                                                                                                                                                                                                    |
| `button.tsx`        | All interactive buttons. Source: `packages/ui/src/components/Button/Button.tsx`. Variants (`type=`): `primary`, `default`, `secondary`, `outline`, `dashed`, `ghost`→`text`, `link`, `danger`, `warning`. Sizes: `tiny` (h-[26px]), `small` (h-[34px]), `medium` (h-[38px]), `large` (h-[42px]), `xlarge`. Extra props: `loading`, `iconLeft`, `iconRight`, `block`, `rounded`, `htmlType`. |
| `card.tsx`          | Panel container. Use `<Card>` / `<CardHeader>` / `<CardTitle>` / `<CardDescription>` / `<CardContent>` / `<CardFooter>`.                                                                                                                                                                                                                                                                    |
| `checkbox.tsx`      | Radix-based checkbox with the same focus ring as `<Input>`.                                                                                                                                                                                                                                                                                                                                 |
| `dialog.tsx`        | Modal dialog. Focus-trap, ESC, click-outside, scroll-lock from Radix. Use `<Dialog>` + `<DialogTrigger>` + `<DialogContent>` (`Header`, `Title`, `Description`, `Footer`, `Close`).                                                                                                                                                                                                         |
| `dropdown-menu.tsx` | Action menu (e.g. row-level ⋮). Use on triggers like Button icon.                                                                                                                                                                                                                                                                                                                           |
| `input.tsx`         | Text-style inputs. Defaults to `h-9 bg-input border-border focus-visible:ring-ring`.                                                                                                                                                                                                                                                                                                        |
| `label.tsx`         | Form label (associates via `htmlFor`).                                                                                                                                                                                                                                                                                                                                                      |
| `radio-group.tsx`   | Radio set. Use `<RadioGroup>` + `<RadioGroupItem>`.                                                                                                                                                                                                                                                                                                                                         |
| `scroll-area.tsx`   | Custom scroll container with themed scrollbars.                                                                                                                                                                                                                                                                                                                                             |
| `select.tsx`        | Dropdown picker. Use `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`. Pass `className="border-dashed"` on the trigger for filter-chip look.                                                                                                                                                                                                                             |
| `separator.tsx`     | Horizontal divider.                                                                                                                                                                                                                                                                                                                                                                         |
| `sonner.tsx`        | Toast (`<Toaster />` global) — call `toast(...)` from `sonner`.                                                                                                                                                                                                                                                                                                                             |
| `table.tsx`         | Table primitives. Use `<Table>` + `<TableHeader>` + `<TableBody>` + `<TableRow>` + `<TableHead>` + `<TableCell>`.                                                                                                                                                                                                                                                                           |
| `tabs.tsx`          | Tab navigation primitives (currently unused — reserved).                                                                                                                                                                                                                                                                                                                                    |
| `textarea.tsx`      | Multi-line input.                                                                                                                                                                                                                                                                                                                                                                           |
| `tooltip.tsx`       | Hover/focus tooltip. Wrap with `<TooltipProvider>` at app root.                                                                                                                                                                                                                                                                                                                             |

## Conventions

1. **`cn()` from `@/lib/utils` for every className** — composes `clsx` + `tailwind-merge` so conditional overrides actually win.
2. **Variants live in `cva()` co-located with the primitive.** Don't fork or re-implement variants in pages.
3. **Tokens are CSS variables defined in `apps/web/src/index.css`** under the `@theme {}` block. To add a new color, extend `@theme` and Tailwind generates `bg-foo` / `text-foo` / `border-foo` automatically.
4. **Icons come from `lucide-react` only.** No inline SVG except the brand logomark.
5. **No inline `style={{}}` with color / spacing values.** The pre-commit grep guard at `apps/web/scripts/check-inline-styles.sh` will fail the build.
6. **Path alias `@/...` maps to `apps/web/src/...`** (wired in `vite.config.ts` + `tsconfig.json`).

## Adding a new primitive

```bash
cd apps/web
pnpm dlx shadcn@latest add <component>
```

Then customize as needed and commit the generated file. Update this README with the new entry.

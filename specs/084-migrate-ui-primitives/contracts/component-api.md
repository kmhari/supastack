# Component API Contracts

These contracts define the stable import/usage interface for dashboard components after migration. Call sites depend on these contracts; changes here ripple to all consumers.

---

## Import Contract (unchanged)

All components continue to be imported from the same path alias. No consumer changes import paths.

```ts
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
// ... etc
```

The import path contract `@/components/ui/<name>` is **stable** across this migration.

---

## Button

**Before (supastack shadcn-style):**
```tsx
<Button variant="default" | "secondary" | "outline" | "ghost" | "link" | "destructive"
        size="default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
        disabled={boolean}
        asChild={boolean}
        className={string}
        onClick={handler}
>
  Label
</Button>
```

**After (Supabase DS):**
```tsx
<Button type="primary" | "default" | "outline" | "text" | "link" | "danger"
             | "secondary" | "dashed" | "warning" | "alternative"
        size="tiny" | "small" | "medium" | "large" | "xlarge"
        loading={boolean}           // NEW: built-in spinner
        iconLeft={ReactNode}        // NEW: leading icon slot
        iconRight={ReactNode}       // NEW: trailing icon slot
        block={boolean}             // NEW: full-width
        rounded={boolean}           // NEW: pill shape
        htmlType="button" | "submit" | "reset"   // replaces type= for HTML type
        disabled={boolean}
        asChild={boolean}
        className={string}
        onClick={handler}
>
  Label
</Button>
```

**Breaking changes:**
- `variant=` prop removed → use `type=`
- `size=` values renamed (see data-model.md mapping table)
- HTML button `type` attribute now set via `htmlType=` (the `type=` prop is taken by the visual variant)

---

## Input

**Before:**
```tsx
<Input type={string} placeholder={string} value={string}
       className={string} disabled={boolean} ...HTMLInputProps />
```

**After:**
```tsx
<Input size="tiny" | "small" | "medium" | "large" | "xlarge"
       type={string} placeholder={string} value={string}
       className={string} disabled={boolean} ...HTMLInputProps />
```

**Additive change only** — `size=` prop added, default is `"small"`. Existing call sites with no `size=` continue to work.

---

## Other Shadcn Components (Badge, Card, Dialog, Sheet, Select, DropdownMenu, Separator, Checkbox, RadioGroup, Switch, Textarea, Tabs, Tooltip, Alert, Label, ScrollArea)

No breaking API changes. These are drop-in replacements — same exported component names, same Radix-based prop interfaces. The only change is the CSS token layer they reference (handled by the token migration, transparent to call sites).

**Badge note**: Verify variant names are consistent after vendoring. Supabase's badge may have additional variants (`success`, `warning`) not in supastack's current shadcn version.

---

## Excluded Components (API unchanged)

### input-with-suffix

```tsx
<InputWithSuffix suffix={ReactNode} ...InputProps />
```

Internal implementation updated to compose the new vendored `Input`, but the external API is unchanged.

### Sonner (toast)

```tsx
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
// usage unchanged
```

Token references inside `sonner.tsx` updated to new token names, but the external API is unchanged.

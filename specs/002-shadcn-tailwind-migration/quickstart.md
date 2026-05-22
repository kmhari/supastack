# Quickstart: Shadcn + Tailwind UI Migration

**Feature**: 002-shadcn-tailwind-migration · **Phase**: 1

End-to-end verification script run AFTER the migration is complete. Each step exercises one user story or one functional requirement so a failure tells you exactly which scope regressed.

---

## 0. Pre-flight (one-time)

```bash
cd /Users/lord/Code/superbase
git checkout 002-shadcn-tailwind-migration
pnpm install
pnpm --filter @selfbase/web typecheck
pnpm --filter @selfbase/web build
```

All three must pass with zero errors. Then deploy to the VM:

```bash
rsync -az --checksum --exclude node_modules --exclude dist \
  apps/web ubuntu@148.113.1.164:/opt/selfbase/apps/

ssh ubuntu@148.113.1.164 "
  cd /opt/selfbase/infra
  docker compose --env-file /opt/selfbase/.env build --no-cache web
  docker compose --env-file /opt/selfbase/.env up -d web
"
```

Wait ~10s for the new bundle to come up. Open `http://148.113.1.164/` in a private browser window.

---

## 1. Grep guards (FR-010, FR-011, SC-003, SC-004)

These checks are runtime-zero (~1s each) and fail loudly when they fail.

```bash
# A. No inline hex colors in pages/ or components/
! grep -rnE 'style=\{\{[^}]*#[0-9a-fA-F]{3,8}' apps/web/src/pages apps/web/src/components

# B. No imports from the dead vendored tree
! grep -rn 'from .*theme/components' apps/web/src

# C. The dead tree no longer exists
[ ! -d apps/web/src/theme/components ]

# D. theme.ts is gone
[ ! -f apps/web/src/lib/theme.ts ]
```

All four must exit with code 0 (i.e., the negated `!` matches return nothing).

---

## 2. Public flows (User Story 1, P1)

### 2a. Login

1. Visit `/login` while signed out.
2. **Verify**: The form renders inside a `<Card>` primitive — same column width as before (24rem / 384px).
3. **Verify**: Both inputs use the shadcn `<Input>` primitive — consistent height, focus ring is brand green.
4. **Verify**: Submit button uses the `<Button variant="default">` (brand green, 36px tall, white text).
5. Tab from email → password → submit. **Verify**: focus-visible ring is visible at each step.
6. Submit with the known credentials `hari@f22labs.com` / `testpw1234`. Expect redirect to `/` (Projects dashboard).

### 2b. Setup gate

1. Open a new private window, visit `/setup`. Expect redirect to `/login` (setup already complete; `SetupGate` works).
2. Visit `/login` in the same window. Expect the login form to render (no setup gate bounce).

---

## 3. Projects dashboard (User Story 1, FR-007, SC-002)

1. From the authenticated state, land on `/`.
2. **Verify** top chrome:
   - Logomark + "Selfbase" wordmark on the left
   - Active nav highlight on "Projects" — using shadcn `<Button variant="ghost">` styled-as-tab pattern
   - User email + Sign-out button on the right
3. **Verify** page header: "Projects" — 30px, weight 400, `-0.02em` letter-spacing.
4. **Verify** toolbar:
   - Search input with magnifying-glass `<lucide:Search>` icon prefix (no hand-rolled SVG)
   - "Status" dropdown — now a Radix `<Select>` with proper keyboard nav. Open it with the keyboard (Tab → Space → arrow keys). Expect smooth open/close, ESC dismisses.
   - "Sorted by name" inline with a `<lucide:ArrowDownUp>` icon
   - View toggle: two `<Button variant="ghost" size="icon">` buttons (grid/list) with active state
   - "+ New project" — `<Button variant="default">` with `<lucide:Plus>` icon
5. With no projects: **Verify** empty state — dashed-border card with `<lucide:Package>` icon + "Create a project" heading + subtitle + "+ New project" button. Identical to the pre-migration design.
6. Click "+ New project" → land on `/instances/new`.

---

## 4. Create a project (User Story 1, FR-002, FR-003)

1. On `/instances/new`, **verify** the layout is a single `<Card>` with header + 2 rows separated by `<Separator>` + footer with two buttons.
2. **Verify** "Project name" and "Database password" rows are stacked with consistent label-on-left / field-on-right grid.
3. **Verify** "Generate a password" is a `<Button variant="link">` inside the password row hint (not a hand-rolled `<button>` with inline style).
4. Click "Generate a password" → password field populates with 32 alphanumerics. Show/Hide toggle (`<lucide:Eye>` / `<lucide:EyeOff>`) works.
5. Enter "test-project" + click "Complete setup" (or whatever the final button label is — `Create new project`).
6. **Verify**: redirect to `/p/<ref>`. Backend should accept and start provisioning.

---

## 5. Project detail (User Story 1, FR-005, FR-006)

1. On `/p/<ref>`, **verify**:
   - Page header: project name + ref subtitle
   - Status pill renders via `<StatusPill>` (badge primitive) — uppercase mono, color-tinted by status
   - Three `<Card>` sections: URLs, Credentials, Lifecycle
2. Click "Reveal credentials":
   - **Verify**: a Radix `<Dialog>` opens (not the old hand-rolled modal). Background dims, dialog is focus-trapped (Tab cycles within the dialog).
   - **Verify**: ESC closes the dialog. Click-outside closes the dialog.
   - Enter your password → credentials reveal.
3. **Verify** revealed credentials use `<Input readonly>` or `<code>` with `<CopyButton>` next to each. Clicking copy shows "Copied ✓" briefly.
4. Lifecycle buttons (Pause / Resume / Restart / Delete) — all `<Button variant="…">`. Delete uses `<Button variant="destructive">`. Clicking Delete opens a confirmation `<Dialog>` (replacing `window.confirm()`).

---

## 6. Backups (User Story 1, FR-004)

1. Visit `/p/<ref>/backups`.
2. **Verify** schedule card has a `<Checkbox>` (Radix-driven, accessible) for "Daily auto-backup" and an `<Input type="number">` for retention.
3. **Verify** backup history table uses the shadcn `<Table>` primitive — consistent header padding, hairline dividers, status pill in each row.
4. Trigger a backup → row appears with `<StatusPill status="running">` then transitions to `completed` after the worker job finishes.

---

## 7. Settings (User Story 1, FR-004, FR-008)

### 7a. Settings → Organization

1. Active nav tab = "Settings".
2. Two `<Card>` sections: Identity + Backup store.
3. **Verify** backup-store kind toggle uses `<RadioGroup>` (Radix-driven). Selecting an option changes which conditional fields render below.

### 7b. Settings → Members

1. Active nav tab = "Members".
2. Invite form uses `<Input>` (email) + `<Select>` (role: Member / Admin) + `<Button>` (Invite).
3. Members table uses `<Table>`. Revoke / Remove actions use `<Button variant="link">` with `<lucide:Trash2>` or text.

### 7c. Settings → Tokens

1. Active nav tab = "Tokens".
2. Create-token form: `<Input>` + `<Button>`.
3. After creation, the new-token panel uses `<Alert variant="warn">` for the "shown once" notice + a `<CopyButton>` for the token value.
4. Existing-tokens table uses `<Table>`.

### 7d. Settings → Audit

1. Active nav tab = "Audit". Wide layout (1280px max).
2. Single `<Card>` containing a `<Table>` of audit entries.
3. **Verify** action column uses a `<Badge variant="outline">` with monospace font.

---

## 8. Toast feedback (FR-005, FR-014)

1. Open Settings → Tokens. Click Copy on a freshly-created token.
2. **Verify**: a shadcn `<Toast>` slides in from the bottom-right corner saying "Token copied to clipboard". Auto-dismisses after ~4s.
3. Repeat for a CopyButton elsewhere.

---

## 9. Keyboard-only navigation (SC-006)

Close your mouse / trackpad. Drive every flow from §2 through §8 using only Tab / Shift+Tab / Enter / Space / Escape / arrow keys.

**Expect**:
- Every interactive control reachable with Tab.
- Focus-visible ring (brand green) on every focused element.
- Dialogs trap focus when open; ESC dismisses.
- Select / DropdownMenu open with Enter or Space; arrow keys navigate options.
- No invisible focus.

---

## 10. Bundle size (FR-015, SC-007)

```bash
# Baseline captured before step 1 of the migration:
echo "Baseline (pre-migration):  $(cat /tmp/web-baseline-size.txt) bytes"

# Current bundle:
docker exec selfbase-web-1 sh -c 'cat /srv/assets/index-*.js | wc -c'

# Ratio:
# new / baseline ≤ 1.20
```

If growth exceeds 20%, take a closer look at the largest Radix primitives (Dialog / DropdownMenu / Select) and lazy-load them per-route via `React.lazy`.

---

## 11. Performance sanity (SC-002, SC-007)

In Chrome DevTools, Network tab disabled cache, hard-refresh `/`. Confirm:
- Total transfer size for the dashboard < 500KB gzipped.
- LCP < 1.5s on a fast connection.
- No console errors.

---

## Done

If every section above passes, the migration meets all 8 success criteria. Merge `002-shadcn-tailwind-migration` to the default branch and delete the feature branch.

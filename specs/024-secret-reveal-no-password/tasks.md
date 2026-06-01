# Tasks: Secret Reveal — No-Password UI Masking

**Input**: Design documents from `specs/024-secret-reveal-no-password/`

**Prerequisites**: plan.md ✓ | spec.md ✓ | research.md ✓ | data-model.md ✓ | contracts/ ✓

**Tests**: Not explicitly requested in spec. No test tasks generated.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no cross-task dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: No new packages, no DB schema changes, no new infrastructure. This phase is effectively empty for this feature — all changes are within existing files.

*No setup tasks required.*

---

## Phase 2: Foundational (Blocking Prerequisites for US1 + US2)

**Purpose**: Backend and shared frontend changes that MUST be complete before the JWT Keys and API Keys UI stories can be implemented.

**⚠️ CRITICAL**: US1 and US2 cannot start until this phase is complete.

- [X] T001 Strip password verification from `POST /api/v1/instances/:ref/credentials/reveal` in `apps/api/src/routes/instances.ts` — remove `schemas.CredentialRevealRequest.parse(req.body)`, remove the `verifyPassword` block and `select({ hash })` query; keep `app.authorize`, `app.requireAuth`, `fetchInstance`, `decryptJson`, `auditLog` insert, and response unchanged
- [X] T002 [P] Update `instancesApi.reveal` in `apps/web/src/lib/api.ts` — change signature from `(ref, { password })` to `(ref)` and drop the body argument from the `client.post(...)` call
- [X] T003 Simplify `useRevealCredentials` hook in `apps/web/src/lib/use-reveal-credentials.ts` — remove `password`, `setPassword`, `dialogOpen`, `openDialog`, `closeDialog` state and related returns; `reveal()` calls `instancesApi.reveal(ref)` directly with no arguments; keep `creds`, `pending`, `error`, `reveal` in return value

**Checkpoint**: Backend no longer requires a password body; the hook no longer manages dialog state. US1 and US2 can now be implemented.

---

## Phase 3: User Story 1 — Reveal JWT Secret (Priority: P1) 🎯 MVP

**Goal**: Admin sees masked JWT secret on page load; clicks "Reveal" → API call (loading state) → value shown → button becomes Copy.

**Independent Test**: Navigate to `/dashboard/project/:ref/jwt-keys`. Confirm masked display. Click Reveal, see loading state, then actual JWT secret. Confirm the Reveal button is gone and Copy button appears. Refresh — confirms value is masked again.

### Implementation

- [X] T004 [US1] Rewrite `ProjectJwtKeys.tsx` in `apps/web/src/pages/ProjectJwtKeys.tsx`:
  - Remove `RevealDialog` import and JSX usage
  - Change `useRevealCredentials` usage: replace `reveal.openDialog` with `() => void reveal.reveal()`; pass `pending` down
  - Update `JwtSecretInput` props to accept `onReveal: () => void` and `pending: boolean`
  - `JwtSecretInput` before reveal: `value={masked}`, `noCopy={true}`, `rightSlot={<FrameButton onClick={onReveal} disabled={pending}>{pending ? 'Loading…' : 'Reveal'}</FrameButton>}`
  - `JwtSecretInput` after reveal: `value={actual}`, `noCopy={false}`, `rightSlot={undefined}` (built-in Copy button appears)
  - Remove `Eye`/`EyeOff` imports and the show/hide toggle — reveal is one-way

**Checkpoint**: JWT Keys page works end-to-end with no RevealDialog. US1 is independently testable.

---

## Phase 4: User Story 2 — Reveal API Keys (Priority: P1)

**Goal**: Admin sees both anon and service_role keys masked; a single "Reveal" click fetches both; both become visible with Copy buttons. No password dialog.

**Independent Test**: Navigate to `/dashboard/project/:ref/api-keys`. Confirm both keys are masked. Click Reveal on either key — both become visible. Confirm anon key is shown in full, service_role key is shown in full. Copy buttons appear on both.

### Implementation

- [X] T005 [US2] Rewrite `ProjectApiKeys.tsx` in `apps/web/src/pages/ProjectApiKeys.tsx`:
  - Remove `RevealDialog` import and JSX usage
  - Change `useRevealCredentials` usage: wire Reveal button directly to `() => void reveal.reveal()` with `reveal.pending` for loading state
  - Update `KeyRow` to accept `onReveal: () => void` and `pending: boolean` instead of just `onReveal`
  - `KeyRow` before reveal: `displayValue = masked`, `noCopy={true}`, `rightSlot={<FrameButton onClick={onReveal} disabled={pending}>{pending ? 'Loading…' : 'Reveal'}</FrameButton>}`
  - `KeyRow` after reveal: `displayValue = value` (always, for both keys — no re-mask), `noCopy={false}`, `rightSlot={undefined}` (built-in Copy appears)
  - Remove `Eye`/`EyeOff` imports and the `shown` toggle — reveal is one-way for both keys

**Checkpoint**: API Keys page works end-to-end with no RevealDialog. Both US1 and US2 are independently testable.

---

## Phase 5: User Story 3 — Reveal OAuth Provider Client Secrets (Priority: P2)

**Goal**: OAuth provider drawers show a "Reveal" button when a secret is saved. Clicking it fetches and populates the input as plain text; button disappears.

**Independent Test**: Open any OAuth provider drawer (e.g., GitHub) where a client secret has been saved. Confirm masked input with "Reveal" button. Click Reveal → loading state → input shows plaintext secret → Reveal button disappears. Open a drawer with no saved secret → confirm no Reveal button.

### Backend (prerequisite for frontend)

- [X] T006 Export `getPlaintextConfig` from `apps/api/src/services/runtime-config-store.ts` — add a new exported async function `getPlaintextConfig(ref: string, surface: ConfigSurface): Promise<ConfigJson>` that calls the already-private `loadCurrentPlaintext(ref, surface)` and returns the result directly (no redaction)
- [X] T007 Add `GET /projects/:ref/config/auth/reveal` to `apps/api/src/routes/management/auth-config.ts` — requires `app.requireAuth` + `app.authorize(req, 'auth_config.read')`; calls `getPlaintextConfig(req.params.ref, 'auth')`; inserts audit log row `{ action: 'secret.reveal', targetKind: 'instance', targetId: ref, payload: { surface: 'auth' } }`; returns plaintext config JSON; 404 if project not found

### Shared frontend prerequisites (T008 + T009 parallelizable with each other)

- [X] T008 [P] Add `revealAuthConfig` to `instancesApi` in `apps/web/src/lib/api.ts` — `revealAuthConfig: (ref: string) => unwrap<Record<string, unknown>>(client.get('/projects/${ref}/config/auth/reveal'))`
- [X] T009 [P] Make `suffix` prop optional in `apps/web/src/components/ui/input-with-suffix.tsx` — change `suffix: React.ReactNode` to `suffix?: React.ReactNode` in the props interface

### OAuth form updates (T010–T015 all parallelizable, all depend on T008 + T009)

- [X] T010 [P] [US3] Update `apps/web/src/pages/auth-providers/CommonFour.tsx`:
  - Add `import { instancesApi } from '@/lib/api'`
  - Add `revealed` (boolean) and `revealing` (boolean) state
  - Add `async function handleReveal()`: calls `instancesApi.revealAuthConfig(projectRef)`, extracts `cfg[fm.secret!]`, sets `secret` state to plaintext value, sets `revealed = true`
  - `hasSavedSecret = Boolean(authConfig[fm.secret!])`: only show Reveal button when true
  - `suffix` of `InputWithSuffix`: `revealed ? undefined : (hasSavedSecret ? <Button ... onClick={handleReveal} disabled={revealing}>{revealing ? 'Loading…' : 'Reveal'}</Button> : undefined)`
  - `<Input type={revealed ? 'text' : 'password'} ...>` (switches to plain text after reveal)

- [X] T011 [P] [US3] Update `apps/web/src/pages/auth-providers/GoogleForm.tsx` — same pattern as T010; field is `fm.secret!`; both client secret fields use the single `handleReveal` call that fetches the whole auth config and reads `fm.secret!`

- [X] T012 [P] [US3] Update `apps/web/src/pages/auth-providers/PlusUrl.tsx` — same pattern as T010

- [X] T013 [P] [US3] Update `apps/web/src/pages/auth-providers/AppleForm.tsx` — same pattern as T010; Apple's secret key is `fm.secret!` per the field map

- [X] T014 [P] [US3] Update `apps/web/src/pages/auth-providers/WorkOsShape.tsx` — same pattern as T010

- [X] T015 [P] [US3] Update `apps/web/src/pages/auth-providers/OidcForm.tsx` — same pattern as T010

**Checkpoint**: All three user stories are fully functional. OAuth reveal works end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Run TypeScript build for the web app: `pnpm --filter web build` — fix any type errors introduced by the suffix-optional change or hook simplification
- [X] T017 [P] Run TypeScript build for the API: `pnpm --filter api build` — fix any type errors from the new reveal endpoint or getPlaintextConfig export
- [X] T018 Verify `RevealDialog.tsx` has no active import callers remaining — run `grep -r "RevealDialog" apps/web/src --include="*.tsx"` and confirm only the component file itself contains the name (no pages import it); add a comment noting it is deprecated and can be deleted in a future cleanup task

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Skipped — no tasks
- **Phase 2 (Foundational)**: No dependencies — start immediately. **BLOCKS US1 and US2.**
- **Phase 3 (US1)**: Depends on Phase 2 completion
- **Phase 4 (US2)**: Depends on Phase 2 completion — can run in parallel with Phase 3
- **Phase 5 (US3)**: T006 → T007 → (T008 ‖ T009) → T010–T015. Backend work (T006, T007) must come first; T008 and T009 are independent of each other; form updates (T010–T015) depend on both T008 and T009
- **Phase 6 (Polish)**: Depends on all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2. No dependency on US2 or US3.
- **US2 (P1)**: Starts after Phase 2. No dependency on US1 or US3. Can be done in parallel with US1.
- **US3 (P2)**: Fully independent backend + frontend. Can start in parallel with US1/US2 (T006/T007 can begin while Phase 2 runs, since they touch different files).

### Parallel Opportunities within Phase 2

- T001 (backend instances.ts) and T002 (frontend api.ts) touch different files → can run in parallel
- T003 (use-reveal-credentials.ts) depends on T002 being done first

### Parallel Opportunities within Phase 5

- T006 and (T008, T009) touch different files → T008/T009 can start before T007 completes
- T010–T015 all touch different files → fully parallelizable once T008 + T009 done

---

## Parallel Example: Phase 2 (Foundational)

```
Parallel batch 1:
  Task T001: Strip password from instances.ts (backend)
  Task T002: Update reveal() in api.ts (frontend)

Sequential after batch 1:
  Task T003: Simplify useRevealCredentials hook (depends on T002 API shape)
```

## Parallel Example: Phase 5 (US3)

```
Sequential:
  Task T006: Export getPlaintextConfig from runtime-config-store.ts
  Task T007: Add reveal endpoint to auth-config.ts

Parallel batch (after T007):
  Task T008: Add revealAuthConfig to api.ts
  Task T009: Make suffix optional in input-with-suffix.tsx

Parallel batch (after T008 + T009):
  Task T010: CommonFour.tsx
  Task T011: GoogleForm.tsx
  Task T012: PlusUrl.tsx
  Task T013: AppleForm.tsx
  Task T014: WorkOsShape.tsx
  Task T015: OidcForm.tsx
```

---

## Implementation Strategy

### MVP First (US1 only — 4 tasks)

1. Phase 2: T001 → T002 → T003 (foundational)
2. Phase 3: T004 (JWT Keys page)
3. **STOP and VALIDATE**: JWT secret reveals without password dialog
4. Ship if needed — API Keys and OAuth can follow

### Full Delivery (all stories — 18 tasks)

1. Phase 2 (T001–T003) → unblocks US1 + US2
2. Phase 3 T004 ‖ Phase 4 T005 (US1 + US2 in parallel)
3. Phase 5 T006 → T007 → (T008 ‖ T009) → T010–T015 (US3)
4. Phase 6 T016–T018 (Polish)

---

## Notes

- `RevealDialog.tsx` and `CredentialRevealRequest` Zod schema remain in place after this feature (no active callers). They are explicitly NOT deleted here to keep this diff minimal; tracked for cleanup separately.
- The `hasSavedSecret` check in OAuth forms uses `Boolean(authConfig[fm.secret!])` — truthy when the field is `'***'` (redacted sentinel), falsy when null/undefined (no secret saved).
- T001 must keep the audit log insert even though there is no longer a password gate — this is a deliberate policy decision (see research.md Decision 1).
- All six OAuth form updates (T010–T015) follow an identical pattern — implement one, verify it works, then apply the same change to the remaining five.

# Tasks: URL Configuration page (feature 022)

**Input**: Design documents from `/specs/022-url-configuration/`
**Prerequisites**: [`plan.md`](./plan.md), [`spec.md`](./spec.md), [`research.md`](./research.md), [`data-model.md`](./data-model.md), [`contracts/url-config-ui.md`](./contracts/url-config-ui.md), [`quickstart.md`](./quickstart.md)

**Tests**: Included — FR-013 explicitly requires Playwright browser-test coverage, and the spec calls out Vitest unit + component tests in its Verification Plan. Tests are interleaved with implementation per user story so each story is independently shippable.

**Organization**: 7 phases — Setup, Foundational, then one phase per user story in priority order, then Polish. MVP scope = Phases 1 + 2 + 3 (US1 Site URL) — but this MVP isn't useful in isolation; the realistic shippable increment is Phases 1–4 (US1 + US2) which delivers the operator-unblock for OAuth redirect bouncing.

## Format: `[ID] [P?] [Story] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: `[US1]` Site URL save · `[US2]` Add/remove Redirect URLs · `[US3]` Visual parity · `[US4]` Sidebar + deep-link
- Setup, Foundational, and Polish phase tasks carry no story label.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire the new page into the SPA shell so it loads (as an empty stub) before any logic ships. Page-coverage lint will fail until Phase 1 completes — that's intentional.

- [X] T001 [P] Register `ProjectAuthUrlConfig` in `apps/web/tests/e2e/expected-pages.ts` (entry under the Authentication group, label `URL Configuration`, route `/dashboard/project/:ref/auth/url-configuration`)
- [X] T002 Create stub page component `apps/web/src/pages/ProjectAuthUrlConfig.tsx` that renders `<ProjectShell title="URL Configuration" subtitle="Configure site URL and redirect URLs for authentication">` with empty content; default export named `ProjectAuthUrlConfigPage`
- [X] T003 Add route in `apps/web/src/App.tsx`: lazy-import `ProjectAuthUrlConfigPage`, add `<Route path="/dashboard/project/:ref/auth/url-configuration" element={<ProjectAuthUrlConfigPage />} />` adjacent to the existing `ProjectAuthProvidersPage` route
- [X] T004 Verify locally: `cd apps/web && pnpm typecheck && pnpm lint:page-coverage` (both must pass before moving on)

---

## Phase 2: Foundational (Blocking prerequisites for all stories)

**Purpose**: Build shared helpers and the sidebar entry so US1 and US2 can be implemented in parallel afterward.

- [X] T005 [P] Create `apps/web/src/pages/auth-url-config/redirect-url-helpers.ts` with:
  - `looksLikeValidUrl(input: string): boolean` (URL placeholder trick per research R1 + data-model)
  - `dedupKey(input: string): string` (case-insensitive scheme+host, byte-exact path)
  - `parseAllowList(csv: string | null | undefined): string[]` (split on `,`, trim, filter empty)
  - `serializeAllowList(urls: string[]): string` (join on `,`)
  - `MAX_REDIRECT_URLS = 50` constant
- [X] T006 [P] Create `apps/web/tests/unit/redirect-url-helpers.test.ts` covering the truth tables from data-model.md "Validation rules" section: 13 accept/reject cases for `looksLikeValidUrl`, 6 duplicate-comparison cases for `dedupKey` **plus the WHATWG trailing-slash normalization case (`http://localhost:3000` and `http://localhost:3000/` MUST produce the same `dedupKey` because `new URL()` normalises the missing path to `/`)**, round-trip cases for `parseAllowList`/`serializeAllowList`
- [X] T007 Modify `apps/web/src/components/ProjectShell.tsx` to add `{ to: \`${base}/auth/url-configuration\`, label: 'URL Configuration' }` in the Authentication group, after the Providers entry
- [X] T008 Verify locally: `cd apps/web && pnpm test redirect-url-helpers && pnpm typecheck` (helper tests must pass)

---

## Phase 3: User Story 1 — Set Site URL (P1)

**Story goal**: Operator can set/update Site URL through the dashboard. Saving triggers the auth container reload and the new value lands in `GOTRUE_SITE_URL`.

**Independent test**: With supastack running, navigate to the page, type `https://example.com`, click Save changes. Verify `GET /api/v1/projects/<ref>/config/auth` returns `site_url: "https://example.com"` and `docker exec supastack-<ref>-auth-1 env | grep SITE_URL` shows `GOTRUE_SITE_URL=https://example.com`.

- [X] T009 [US1] Create `apps/web/src/pages/auth-url-config/SiteUrlForm.tsx` (Card + h2 "Site URL" + description + labeled `Input` + Save changes Button). Props: `{ initialValue: string, isAdmin: boolean, onSave: (next: string) => void }`. Maintains `SiteUrlState` view-model from data-model.md (controlled `value`, derived `dirty` + `valid`). Save button disabled unless `valid && dirty`. Member: input disabled + Save button hidden
- [X] T010 [US1] In `ProjectAuthUrlConfig.tsx`: fetch auth-config via `useQuery(['auth-config', ref], () => authConfigApi.get(ref))`; mount `<SiteUrlForm initialValue={authConfig.site_url ?? ''} isAdmin={isAdmin} onSave={save} />`; wire `save` to existing `useRestartToast(ref, …)` utility from `auth-providers/use-restart-toast.ts`
- [X] T011 [P] [US1] Create `apps/web/tests/unit/ProjectAuthUrlConfig.test.tsx` — admin sees Site URL input + Save button; member sees disabled input + no Save button; entering invalid URL keeps Save disabled; valid+dirty enables Save; save mutation called with `{ site_url: '<value>' }`
- [X] T012 [US1] Verify locally: `cd apps/web && pnpm test ProjectAuthUrlConfig && pnpm typecheck`

**Checkpoint**: US1 is now independently shippable. Operators can set Site URL; Redirect URLs section is still missing (rendered as empty placeholder by US2).

---

## Phase 4: User Story 2 — Add and remove Redirect URLs (P1)

**Story goal**: Operator can batch-add multiple redirect URLs via a modal dialog and remove individual URLs from the list. Each save persists the merged list in one PATCH.

**Independent test**: Click Add URL → dialog appears titled "Add new redirect URLs". Add `http://localhost:8765/**`, click Save URLs. URL appears in list. Click trash → URL removed. `docker exec supastack-<ref>-auth-1 env | grep URI_ALLOW_LIST` reflects each save.

- [X] T013 [US2] Create `apps/web/src/pages/auth-url-config/RedirectUrlsList.tsx`. Props: `{ urls: string[], isAdmin: boolean, onDelete: (target: string) => void, onAddClick: () => void }`. Renders: h2 "Redirect URLs", description, Docs link `https://supabase.com/docs/guides/auth/redirect-urls`, Add URL button (admin only), empty state ("No Redirect URLs" / "Auth providers may need a URL to redirect back to") when `urls.length === 0`, otherwise `<ul aria-label="Redirect URLs">` of `<li>` rows each with URL text + trash button (admin only, `aria-label="Remove {url}"`)
- [X] T014 [US2] Create `apps/web/src/pages/auth-url-config/AddRedirectUrlsDialog.tsx` using Radix Dialog primitive. Props: `{ open: boolean, onOpenChange: (open: boolean) => void, existingUrls: string[], onSave: (newUrls: string[]) => void }`. Title "Add new redirect URLs". Subtitle "This will add a URL to a list of allowed URLs that can interact with your Authentication services for this project." Internal state: array of `AddDialogRow` (id/value/error). One empty row on open. "+ Add URL" button appends a row. Trash icon removes a row (re-append empty if last row removed). On Save URLs click: trim → drop empty → validate each via `looksLikeValidUrl` → dedup via `dedupKey` against `existingUrls` → cap check (existing + batch ≤ 50) → if all green, call `onSave(batch)`; else mark offending rows with inline error. Save URLs button is the green full-width primary
- [X] T015 [US2] Wire `RedirectUrlsList` + `AddRedirectUrlsDialog` into `ProjectAuthUrlConfig.tsx`: parse `urls` from `authConfig.uri_allow_list` via `parseAllowList`, manage local `dialogOpen` state, `onAddClick = () => setDialogOpen(true)`, `onSave` builds merged CSV via `serializeAllowList([...urls, ...batch])` then PATCHes via `save({ uri_allow_list: '<csv>' })`, `onDelete` PATCHes with the filtered CSV. Both go through the existing `useRestartToast`
- [X] T016 [P] [US2] Extend `apps/web/tests/unit/ProjectAuthUrlConfig.test.tsx` (added in T011) with US2 cases: clicking Add URL opens dialog; dialog renders one empty row; clicking "+ Add URL" appends a row; **clicking the trash on the only row removes it then re-appends an empty row so the dialog never shows zero rows (lifecycle invariant from data-model AddDialogState)**; typing valid URL + Save URLs invokes save mutation with the merged CSV; entering disallowed scheme shows inline error and does NOT call save; entering duplicate URL shows inline error; cap enforced when existing + batch > 50; member sees no Add URL button and no trash icons
- [X] T017 [US2] Verify locally: `cd apps/web && pnpm test ProjectAuthUrlConfig && pnpm typecheck && pnpm lint:page-coverage`

**Checkpoint**: US1 + US2 together = the operator unblock. Real-world fix for the `localhost:8765` GitHub OAuth bounce delivered.

---

## Phase 5: User Story 3 — Visual parity with Cloud (P2)

**Story goal**: Side-by-side screenshot of the supastack page and Cloud's `/auth/url-configuration` at 1440px viewport produces a reviewer's "yep, same page" reaction.

**Independent test**: Capture screenshots of both pages at 1440px. Verify section order, headings, descriptions, empty-state copy, Docs link, button placement all match.

- [X] T018 [US3] Match Cloud copy verbatim where it appears in `SiteUrlForm.tsx`: page subtitle "Configure site URL and redirect URLs for authentication"; Site URL section description "Configure the default redirect URL used when a redirect URL is not specified or doesn't match one from the Redirect URLs list"; button label "Save changes"
- [X] T019 [US3] Match Cloud copy verbatim where it appears in `RedirectUrlsList.tsx`: section description "URLs that auth providers are permitted to redirect to post authentication. Wildcards are allowed, for example, https://*.domain.com"; empty-state heading "No Redirect URLs"; empty-state subtitle "Auth providers may need a URL to redirect back to"; Docs link text "Docs" with external-link icon, target `_blank`
- [X] T020 [US3] Match Cloud copy verbatim in `AddRedirectUrlsDialog.tsx`: title "Add new redirect URLs"; subtitle "This will add a URL to a list of allowed URLs that can interact with your Authentication services for this project."; row label "URL"; placeholder "https://mydomain.com"; internal button "+ Add URL"; submit button "Save URLs" (full-width emerald green primary, matching the User Signups Save changes button from feature 020)
- [X] T021 [US3] Manual screenshot diff: open `https://supabase.com/dashboard/project/<any-ref>/auth/url-configuration` and `https://<ref>.supaviser.dev/dashboard/project/<ref>/auth/url-configuration` side by side at 1440px in Chrome. Diff captures: section order, spacing, button colors, dialog footprint. Record diffs in `specs/022-url-configuration/screenshots/` (create dir if needed) or in PR comments
- [X] T022 [US3] Verify locally: `cd apps/web && pnpm typecheck`

**Checkpoint**: visual polish complete; functionally identical to Phase 4.

---

## Phase 6: User Story 4 — Sidebar + deep-linking (P3)

**Story goal**: Sidebar entry under Authentication navigates to the page; pasting the URL directly into the address bar loads it.

**Independent test**: Open project shell sidebar. Confirm "URL Configuration" entry under Authentication, below "Providers". Click it; URL changes; page renders. Paste `/dashboard/project/<ref>/auth/url-configuration` directly; page loads.

- [X] T023 [US4] Sidebar entry was added in T007 — verify with browser: open dashboard, navigate to a project, confirm `URL Configuration` link is visible under Authentication and clicking it routes to the page

**Checkpoint**: deep-linking + sidebar both work. (Effectively delivered by Phases 1 + 2; this phase is verification only.)

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Browser-level coverage, deploy, live-VM smoke, docs.

- [X] T024 Create `apps/web/tests/e2e/url-configuration.spec.ts` with the following Playwright specs (admin fixture for default group, member fixture for RBAC group):
  - admin loads page → sees Site URL input + Save button + Add URL button
  - admin types valid URL → clicks Save changes → success toast appears
  - admin enters invalid URL → Save button stays disabled
  - admin clicks Add URL → dialog appears with one empty row
  - admin clicks "+ Add URL" inside dialog → second row appears
  - admin enters URL in row, clicks Save URLs → URL appears in list after restart toast settles
  - admin clicks trash on a list entry → URL removed after restart toast settles
  - admin enters disallowed scheme `javascript:foo` → inline error appears, dialog stays open
  - admin enters duplicate URL → inline error appears, dialog stays open
  - member loads page → sees disabled inputs, no Save button, no Add URL button, no trash icons
  - deep-link: navigate directly to `/dashboard/project/<ref>/auth/url-configuration` → page loads
- [X] T025 Run regression + e2e suites locally as the pre-deploy gate:
  - `cd apps/api && pnpm test upstream-auth-config-snapshot` — FR-014 regression guard: the `_supastack.fieldStatus` snapshot-drift contract test must still pass (no field accidentally re-classified from `honored` → `stored_only` by this feature's work)
  - `cd apps/api && pnpm test` — full api suite (SC-3: zero regressions in feature 020's auth-config PATCH)
  - `cd apps/web && pnpm test` — full web vitest suite (SC-3)
  - `cd apps/web && pnpm test:e2e url-configuration` — all 11 specs must pass against `pnpm dev` (FR-013, SC-5, SC-6)
- [ ] T026 Deploy to supaviser.dev: `rsync -az --exclude=node_modules apps/web/ ubuntu@148.113.1.164:/opt/supastack/apps/web/ && ssh ubuntu@148.113.1.164 'cd /opt/supastack/infra && sudo docker compose build web && sudo docker compose up -d web'`
- [ ] T027 Live-VM smoke per [`quickstart.md`](./quickstart.md) Smokes 1–5 against project `znishgvglkafpmjkqspw` on supaviser.dev: (1) save Site URL, (2) batch-add `http://localhost:3000` + `http://localhost:8765/**`, (3) GitHub OAuth round-trip lands on localhost (THE bug this feature unblocks), (4) delete one URL, (5) member sees read-only. Capture screenshots for the PR
- [ ] T028 Create `docs/changes/022-url-configuration.md` runbook documenting: motivation (the OAuth bounce bug + the SSH-only workaround it replaces), what shipped, breaking changes (none), follow-ups (link from provider drawers — issue to file)
- [ ] T029 Commit + push: `git add -A && git commit -m 'feat(022): URL Configuration page (Site URL + Redirect URLs allow-list)'`; open PR against main with the live-VM smoke screenshots in the body

---

## Dependency graph

```
Phase 1 (Setup)
   │
   ▼
Phase 2 (Foundational)  ─── T005 [P] ─── T006 [P]
   │                          │            │
   │  T007 ─────────────────┐ │            │
   ▼                        ▼ ▼            ▼
Phase 3 (US1)  ──────  T009 → T010 → T011 [P] → T012
   │                          │
   ▼                          │  (US1 and US2 share ProjectAuthUrlConfig.tsx, so T010/T015 must run sequentially)
Phase 4 (US2)  ──────  T013 [P with T014] → T015 → T016 [P] → T017
   │
   ▼
Phase 5 (US3)  ──────  T018 [P], T019 [P], T020 [P] → T021 → T022
   │
   ▼
Phase 6 (US4)  ──────  T023
   │
   ▼
Phase 7 (Polish)  ───  T024 → T025 → T026 → T027 → T028 → T029
```

## Parallel execution examples

**Phase 2 parallel batch**: T005, T006, T007 all touch different files — run together.

**Phase 4 parallel batch**: T013 and T014 are independent files; T016 is independent of both. Sequence: (T013 ∥ T014) → T015 → T016.

**Phase 5 parallel batch**: T018, T019, T020 each touch a distinct file — run together.

## Implementation strategy

**MVP (Phases 1 + 2 + 3)** = operator can set Site URL. Marginally useful in isolation (Site URL alone doesn't unblock the OAuth bounce).

**Real shippable increment (Phases 1–4)** = operator can set Site URL AND manage Redirect URLs. **This** is the unblock — operators no longer need to SSH into the VM to add `http://localhost:8765/**` to their allow list. Recommended ship point.

**Polished increment (Phases 1–5)** = adds visual parity. Recommended target for the PR merge.

**Complete feature (Phases 1–7)** = adds browser-test coverage + deploy + smoke + runbook + PR.

## Format validation

All 29 tasks confirmed to follow the strict checklist format:
- ✓ Start with `- [ ]` checkbox
- ✓ Sequential ID (T001–T029)
- ✓ `[P]` marker where parallel-safe
- ✓ `[US1]` / `[US2]` / `[US3]` / `[US4]` story label for Phase 3–6 tasks; none for Setup/Foundational/Polish
- ✓ Concrete file path in description (or concrete verification command for non-code tasks)

## Suggested next command

`/speckit-implement` — execute Phase 1 first, then proceed through phases. Each phase ends in a checkpoint command (`pnpm test` + `pnpm typecheck`) that must pass before advancing.

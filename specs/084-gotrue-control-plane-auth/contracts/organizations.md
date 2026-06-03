# Contract — Organizations (platform API)

Shapes captured from Studio source (`apps/studio/data/organizations/*`). All mounted under
`/platform`. Self-hosted: billing/plan fields are filled with constant markers (no billing). Pin
field shapes + add a contract test (Constitution IV).

> **Org identifier**: an organization's `id` is a **20-character reference string** (project-ref
> style via `generateRef`, lowercase alphanumeric — **not a UUID**). The `:slug` path param **is**
> this same ref; responses return `slug === id`. The `name` is the editable display label.

## GET /platform/organizations
List orgs the caller belongs to. (`organizations-query.ts`)
- **200**: `OrganizationResponse[]`, each:
  `{ id, slug, name, billing_email, plan: { id: 'free'|'platform', name }, is_owner: bool,
     organization_requires_mfa: false, restriction_status: null, usage_billing_enabled: false }`
  (other Cloud fields — `billing_partner`, `opt_in_tags`, `stripe_customer_id`, `subscription_id` —
  returned as `null`/empty for self-hosted.)
- `is_owner` = caller's role in that org is Owner. Empty array if no memberships.

## POST /platform/organizations
Create; caller becomes Owner. (`organization-create-mutation.ts`)
- Body (Studio sends): `{ name, tier: 'tier_free'|'tier_platform'|…, kind?, size?, payment_method?,
  billing_name?, address?, tax_id? }`. Self-hosted ignores billing fields; `tier` accepted, mapped to
  the constant plan marker.
- **201**: `{ pending_payment_intent_secret: null, id, slug, name, plan }` — `id` = `slug` = a fresh
  20-char ref (`generateRef`); `name` is the display label.
- Side effects: insert `organizations` + `organization_members(Owner)` for the caller.
- Sad: blank `name` → `400`.

## GET /platform/organizations/:slug
- **200**: `OrganizationSlugResponse` = `OrganizationResponse` + `{ has_oriole_project: false,
  restriction_data: null }`. Member-only; else `403`/`404`.

## PATCH /platform/organizations/:slug
Rename / settings. (`organization-update-mutation.ts`)
- Body: `{ name?, billing_email?, opt_in_tags?, additional_billing_emails? }`. Authorize `org.update`
  (Owner/Administrator). Self-hosted honors `name`; billing fields stored-but-inert.
- **200**: `{ id, slug, name, billing_email, opt_in_tags, stripe_customer_id }`.
- Sad: blank name → `400`; insufficient role → `403`.

## DELETE /platform/organizations/:slug
(`organization-delete-mutation.ts`) Authorize `org.delete` (**Owner only**).
- **200/204** if the org owns no projects; cascades members + invitations.
- Sad: org still owns ≥1 project → **409** (FR-015); non-Owner → `403`.

## Out of this contract
`organizations/cloud-marketplace` (marketplace create), `usage`, `usage/daily`, `entitlements`,
`available-versions`, `sso`, `billing/*` → stubbed or out of scope (see spec Platform API Surface).

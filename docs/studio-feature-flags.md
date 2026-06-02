# Supabase Studio feature flags (`disabled_features`)

How to hide/disable Studio menus, pages, and features **without touching Studio source** — the
core mechanism behind running a reduced "supastack cloud" Studio (`IS_PLATFORM=true`).

Source of truth: `packages/common/enabled-features/enabled-features.json` in the vanilla Studio repo
(Studio v0.0.9). Every flag is a `"<area>:<scope>"` string read via
`useIsFeatureEnabled('<flag>')`, which gates the relevant nav item **and** the page.

## How it composes (3 layers)

`useIsFeatureEnabled` (`apps/studio/hooks/misc/useIsFeatureEnabled.ts`) merges, in order:

1. **Static defaults** — `enabled-features.json`, baked at `next build` time. Editing this is a
   source change (a fork patch) — avoid.
2. **`profile.disabled_features`** — array on the `GET /platform/profile` response. **Runtime,
   platform/operator-global.** ✅ **This is the lever we use** (returned from `platform-misc.ts`).
3. **`ENABLED_FEATURES_*` env override** — `apps/studio/.../enabled-features` runtime override.
   ⚠️ **Gated `!IS_PLATFORM`** (`useEnabledFeaturesOverrideQuery` is `enabled: !IS_PLATFORM`), so it
   **does NOT apply in our `IS_PLATFORM=true` deployment.** (Self-hosted/`IS_PLATFORM=false` only.)

> **For supastack (`IS_PLATFORM=true`): disable a feature by adding its key to the
> `disabled_features` array in the `GET /platform/profile` response** (`apps/api/src/routes/platform-misc.ts`).
> Because `profile` is operator-global, it applies to **every project automatically** — no per-project config, no Studio source edit, no rebuild.

### Example

```jsonc
// GET /api/v1/platform/profile  →  hides billing, usage/reports, replication, read-replicas, etc.
{
  "id": "...",
  "disabled_features": [
    "billing:all",
    "reports:all",
    "database:replication",
    "infrastructure:read_replicas"
  ]
}
```

A flag set here removes both the sidebar/nav entry and the page content across all projects.

## Full flag list

Default value in `enabled-features.json` shown as ✅ enabled / ⬜ disabled-by-default. Add any flag
to `disabled_features` to turn it off.

### Account / Profile
| Flag | Default | Disables |
|---|---|---|
| `account:show_security_settings` | ✅ | Account security settings |
| `profile:show_email` | ✅ | Email field on profile |
| `profile:show_information` | ✅ | Profile information section |
| `profile:show_analytics_and_marketing` | ✅ | Analytics/marketing prefs |
| `profile:show_account_deletion` | ✅ | Account deletion |

### Billing & usage
| Flag | Default | Disables |
|---|---|---|
| `billing:all` | ✅ | **All billing** (nav + pages) |
| `reports:all` | ✅ | **All reports / usage** |
| `project_addons:dedicated_ipv4_address` | ✅ | Dedicated IPv4 add-on |
| `project_addons:show_compute_price` | ✅ | Compute pricing display |
| `project_homepage:show_instance_size` | ✅ | Instance size on project home |

> Note: the Profile API type also accepts billing sub-flags not in the static JSON —
> `billing:invoices`, `billing:credits`, `billing:payment_methods`, `billing:account_data` — if you
> want finer-grained billing hiding instead of `billing:all`.

### Database
| Flag | Default | Disables |
|---|---|---|
| `database:replication` | ✅ | **Database Replication** (nav + page) |
| `database:roles` | ✅ | Database Roles |
| `database:restore_to_new_project` | ✅ | Restore-to-new-project |
| `database:network_restrictions` | ✅ | Network restrictions |
| `infrastructure:read_replicas` | ✅ | Read replicas |

### Authentication
| Flag | Default | Disables |
|---|---|---|
| `authentication:sign_in_providers` | ✅ | OAuth provider config |
| `authentication:third_party_auth` | ✅ | Third-party auth |
| `authentication:rate_limits` | ✅ | Rate limits |
| `authentication:emails` | ✅ | Email templates |
| `authentication:multi_factor` | ✅ | MFA config |
| `authentication:attack_protection` | ✅ | Attack protection |
| `authentication:performance` | ✅ | Auth performance |
| `authentication:show_email_phone_columns` | ✅ | Email/phone columns in users table |
| `authentication:show_manual_linking` | ✅ | Manual identity linking |
| `authentication:show_provider_filter` | ✅ | Provider filter |
| `authentication:show_providers` | ✅ | Providers list |
| `authentication:show_custom_providers` | ✅ | Custom providers |
| `authentication:show_send_invitation` | ✅ | Send invitation |
| `authentication:show_sort_by_email` | ✅ | Sort users by email |
| `authentication:show_sort_by_phone` | ✅ | Sort users by phone |
| `authentication:show_user_type_filter` | ✅ | User type filter |

### Project settings / creation / connection
| Flag | Default | Disables |
|---|---|---|
| `project_settings:custom_domains` | ✅ | Custom domains |
| `project_settings:show_disable_legacy_api_keys` | ✅ | Disable-legacy-keys toggle |
| `project_settings:legacy_jwt_keys` | ✅ | Legacy JWT keys |
| `project_settings:log_drains` | ✅ | Log drains |
| `project_settings:database_upgrades` | ✅ | Database upgrades |
| `project_settings:restart_project` | ✅ | Restart project button |
| `project_creation:show_advanced_config` | ✅ | Advanced config on create |
| `project_connection:show_app_frameworks` | ✅ | App framework connect snippets |
| `project_connection:show_mobile_frameworks` | ✅ | Mobile framework snippets |
| `project_connection:show_orms` | ✅ | ORM connect snippets |
| `project_homepage:show_examples` | ✅ | Examples on project home |

### Logs / Storage / Integrations / SDKs
| Flag | Default | Disables |
|---|---|---|
| `logs:all` | ✅ | **All logs** |
| `logs:templates` | ✅ | Log templates |
| `logs:collections` | ✅ | Log collections |
| `logs:metadata` | ✅ | Log metadata |
| `logs:show_metadata_ip_template` | ✅ | IP metadata template |
| `storage:analytics` | ✅ | Storage analytics buckets |
| `storage:vectors` | ✅ | Vector buckets |
| `integrations:partners` | ✅ | Partner integrations |
| `integrations:wrappers` | ✅ | Foreign data wrappers |
| `integrations:vercel` | ✅ | Vercel integration |
| `integrations:aws_private_link` | ✅ | AWS PrivateLink |
| `sdk:auth` `sdk:csharp` `sdk:dart` `sdk:kotlin` `sdk:python` `sdk:swift` | ✅ | Per-language SDK snippets |

### Organization / dashboard-auth / AI / misc
| Flag | Default | Disables |
|---|---|---|
| `organization:show_sso_settings` | ✅ | Org SSO settings |
| `organization:show_security_settings` | ✅ | Org security settings |
| `organization:show_legal_documents` | ✅ | Org legal documents |
| `dashboard_auth:sign_up` | ✅ | Studio sign-up |
| `dashboard_auth:sign_in_with_github` | ✅ | GitHub sign-in |
| `dashboard_auth:sign_in_with_sso` | ✅ | SSO sign-in |
| `dashboard_auth:sign_in_with_email` | ✅ | Email sign-in |
| `dashboard_auth:show_testimonial` | ✅ | Sign-in testimonial |
| `dashboard_auth:show_tos` | ✅ | Sign-in ToS |
| `ai:opt_in_level_disabled` / `:schema` / `:schema_and_log` / `:schema_and_log_and_data` | ✅ | AI Assistant opt-in levels |
| `edge_functions:show_stripe_example` | ✅ | Stripe example |
| `edge_functions:show_all_edge_function_invocation_examples` | ✅ | All invocation examples |
| `quickstarts:hide_nimbus` | ✅ | Nimbus quickstart |
| `cli:disable_custom_profiles` | ✅ | CLI custom profiles |
| `feedback:docs` | ✅ | Docs feedback widget |
| `support:show_client_libraries` | ✅ | Client libs in support |
| `search:fullIndex` | ✅ | Full search index |
| `branding:large_logo` | ⬜ (off) | Large logo (opt-IN: set `true` in static JSON to enable) |

> `docs:*` flags (≈20) gate documentation-search index sections — generally irrelevant to a
> self-hosted dashboard. Listed in `enabled-features.json` if needed.

## Suggested supastack disable set

Sensible defaults to return in `disabled_features` for a self-hosted "supastack cloud" (no billing,
no cloud-only infra, no dead stubs):

```json
[
  "billing:all",
  "reports:all",
  "database:replication",
  "database:restore_to_new_project",
  "infrastructure:read_replicas",
  "project_settings:custom_domains",
  "project_settings:database_upgrades",
  "project_addons:dedicated_ipv4_address",
  "integrations:vercel",
  "integrations:aws_private_link",
  "storage:vectors",
  "organization:show_legal_documents"
]
```

Adjust to taste. None of this requires a Studio source change — it's all returned from
`apps/api/src/routes/platform-misc.ts` on `GET /platform/profile`.

## Why this matters for upstream tracking

`disabled_features` is Studio's own built-in, supported mechanism for cloud-vs-self-hosted feature
gating. Using it (instead of patching Studio source) keeps the Studio checkout pristine, which is
what makes "fork with minor changes + pull upstream updates" near-conflict-free.

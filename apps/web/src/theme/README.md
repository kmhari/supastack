# Vendored Theme

This directory contains source assets lifted from
[`supabase/supabase`](https://github.com/supabase/supabase) at the pinned commit
recorded in `infra/supabase-template/COMMIT`. We **do not** depend on
`@supabase/ui` or any published UI package — we vendor the source and own it.

> Reason: when the user evaluated the published library it didn't match the
> look they wanted, so we lift the Studio internals directly. Trade-off:
> upgrades require re-running the lift script.

## Lift list (pinned to `8cd39680ef7614bbb36ad4f3803c4e7446d22714`)

| Vendored path | Upstream source |
|---|---|
| `tailwind/tailwind.config.css` | `packages/config/tailwind.config.css` |
| `tailwind/typography.config.js` | `packages/config/typography.config.js` |
| `tailwind/unset-tw-colors.css` | `packages/config/unset-tw-colors.css` |
| `tailwind/postcss.config.js` | `packages/config/postcss.config.js` |
| `tailwind/css/*` | `packages/config/css/*` (animations, base, colors, theme, utilities, variants) |
| `tailwind/plugins/*` | `packages/config/tailwind-plugins/*` (hit-area.css) |
| `components/*` | `packages/ui-patterns/src/*` (all components) |
| `components/tailwind.config.css` | `packages/ui-patterns/tailwind.config.css` |
| `.upstream-ref/studio.Dockerfile` | `apps/studio/Dockerfile` (reference only — our own image build is at `infra/studio/Dockerfile`) |

## Known unresolved imports

The vendored `tailwind/tailwind.config.css` references files in `../ui/build/css/`
and a `tw-animate-css` package that we did NOT vendor. When wiring up the
dashboard in Phase 3 we will resolve these by one of:

1. Inlining the relevant CSS files (cleanest), or
2. Adding a small `apps/web/scripts/sync-theme.ts` that fetches the missing
   bits from the same pinned commit and writes them under `tailwind/css/`, or
3. Reaching upstream for the npm package alternatives.

## Tailwind version

These assets target **Tailwind v4** (CSS-first config via `@import 'tailwindcss';`
and `@plugin "..."` declarations). The dashboard Vite setup in `apps/web/`
must use `@tailwindcss/vite` (or equivalent) — not the v3 JS-config plugin.

## Curation in later phases

Phase 3 (US1) tasks will pick which components are actually used in the v1
dashboard. Likely picks: `DataInputs`, `Dialogs`, `form`, `Banners`,
`EmptyStatePresentational`, `ErrorDisplay`, `IconPanel`, `Table`, `TextLink`,
`PageHeader`, `PageContainer`, `PageBreadcrumbs`, `PageNav`, `Row`,
`MetricCard`, `ShimmeringLoader`, `info-tooltip.tsx`, `admonition.tsx`,
`collapsible-alert.tsx`, `multi-select`. The rest can be deleted from the
vendored copy at that time.

## Updating the lift

```sh
# from repo root
COMMIT=$(cat infra/supabase-template/COMMIT)
git clone --depth=1 --filter=blob:none --sparse https://github.com/supabase/supabase.git /tmp/sb
cd /tmp/sb && git checkout "$COMMIT" && git sparse-checkout set apps/studio packages/common packages/config packages/ui-patterns

# then sync (idempotent overwrite)
SRC=/tmp/sb DST=$REPO_ROOT/apps/web/src/theme
cp -r $SRC/packages/config/css/ $DST/tailwind/css/
cp -r $SRC/packages/ui-patterns/src/ $DST/components/
# … etc per Lift list table above
```

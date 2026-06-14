# Supastack — marketing site

The public marketing + feature-map site for **Supastack**, the open-source
control plane for self-hosted Supabase. A small, fast, **no-build** React SPA
that ships as plain static files and deploys to GitHub Pages.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — loads React, Babel, Tailwind (Play CDN) + fonts, mounts the app |
| `components.jsx` | shadcn-style primitives: Button, Card, Badge, Mono, CopyCommand, icons |
| `landing.jsx` | Landing — hero, "the gap" spectrum, what-you-get, data-plane, CTA |
| `features.jsx` | The feature map — Groups A (Available) / B (Roadmap) / C (Never) |
| `app.jsx` | Header, footer, layout helpers, hash-based routing |

Two pages are client-side hash routes (`#/` and `#/features`) — no server
needed. All asset paths are **relative**, so it works served from the repo
subpath (`https://<user>.github.io/<repo>/`).

## Run locally

The JSX is transpiled in-browser by Babel, so any static file server works:

```bash
cd website
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy

Deployment is automated by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml):
every push to `main` that touches `website/**` uploads this folder and
publishes it to GitHub Pages. The workflow enables Pages on first run
(`actions/configure-pages` with `enablement: true`), so no manual
**Settings → Pages** toggle is required — just push.

If your org restricts Actions from enabling Pages, do it once manually:
**Settings → Pages → Build and deployment → Source → GitHub Actions**.

## Notes

- **No telemetry, no analytics, no trackers** — the no-phone-home promise
  applies to the site too. Fonts load from Google Fonts (with a system
  fallback); React + Tailwind load from CDN. Nothing reports usage.
- For a production deployment you can optionally precompile the JSX and inline
  Tailwind to drop the CDN/in-browser-Babel dependencies — not required.
- Community project. **Not affiliated with Supabase Inc.** AGPL-3.0-only.

# Web App Agent Guide

## Package manager

- This repository is a pnpm workspace. Use pnpm from the repository root or `pnpm --filter @olowo/web ...`.
- Do not create npm/yarn lockfiles and do not run `npm install`, `npm ci`, or `npm run`.

## What this app is

olowo is a real, responsive oloo client for phones and desktops. It is not a phone mockup: do not add device frames, bezels, simulated status bars, simulated keyboards, or any "prototype runtime".

## Product decisions

- The map is the primary surface and fills the viewport. Panels float over it; never shrink the map into a small overview.
- The map shows **stations**, not individual scooters. Station pins read `available/total` (e.g. `3/5`). Opening a station plots each docked scooter as a small tappable dot at its own GPS fix; the selected scooter becomes a plate tag. No fan-out or halo.
- Scan-to-borrow stays: 「掃碼借車」 opens the camera scanner (`qr-scanner`, lazy-loaded) with a typed-plate fallback; the API resolves the code (`/v1/scooters/lookup`).
- Overview and station views share one three-column summary: 可借 / 沒電 (below the region's battery floor) / 故障 (switched off by oloo).
- Controller fault reports are warnings, never blocks; oloo decides at rent time.
- E-fences are prominent: the riding area has a solid green edge and everything outside oloo's operating areas is dimmed; restricted zones are filled in oloo's colour.
- No battery or availability filters. The station list is campus-scoped (search reaches all campuses), sorted by distance with stations that have nothing to borrow at the bottom.
- Borrowing offers two buttons: 「立即借用」 and 「預約 5 分鐘」 (with a countdown, also in the dock). Reservation limits quote oloo's own rules and counts (`/v1/reservations/usage`); never invent quotas.
- Ride timers offer only 自動歸還 and 歸還後重借 at 0:30, 0:58, 4:58 or a custom duration. They are toggles that apply on tap and stay editable; nothing asks for a second confirmation.
- After return the rider goes straight to checkout with the blank photo already attached (「還車照片（可選）」); a real photo can replace it.
- The account view links to 騎乘紀錄 (`?view=history`), 訂閱方案 (`?view=plans`) and 優惠券 (`?view=coupons`), and ends with the credits (毛哥EM, GitHub link).
- Buying a plan or a top-up always shows oloo's estimate (amount, start and end) before 「付款」; that step is the price, not a confirmation dialog. Only plans some region offers are sold; hidden campaign or staff plans are not.
- The README shows `public/assets/brand/og.webp` (also the Open Graph image). `pnpm screenshots` (`tests/screenshots.spec.ts`, mocked API, real Mapbox tiles) renders fresh screenshots into `docs/screenshots/` when needed.
- SEO lives in `index.html` (title 「olowo - 好用快速的 oloo 客戶端」, Open Graph, Twitter card, JSON-LD); `vite.config.ts` fills `%SITE_ORIGIN%` from `VITE_PUBLIC_ORIGIN` (compose passes `PUBLIC_ORIGIN`) and emits `robots.txt` and `sitemap.xml`.
- The avatar is the rider's Gravatar (SHA-256 of the email), falling back to the initial.
- Icons are the olowo wordmark (`public/assets/brand`); do not ship oloo's logo or artwork.
- Phones (< 920 px): a draggable bottom sheet with `peek`, `half` and `full` snaps. Detail views open at `half` so the map stays visible. Desktop: a floating left panel over a full-bleed map.
- Signed-out riders see sign-in first: station data comes from oloo and needs their credential. Do not add demo or placeholder stations.
- Every view is addressable by URL (`?station=`, `?scooter=`, `?view=ride|checkout|scan|account|history|plans|coupons`) and the browser back button walks back through views.
- Keep text compact (body 14 px, metadata 12–13 px). Large type is reserved for a single hero number per view (available count, battery, ride clock).
- Label an available scooter `可借`; do not use claims such as `真的借得到`. Unavailable reasons are olowo inferences and must say so.
- Do not add an address selector.

## Structure

- `src/app/` — shell state (`useUiStore`: view, sheet snap, filters, history sync) and the responsive `Panel`.
- `src/features/<feature>/` — `map` (Mapbox canvas and pins), `stations`, `scooter`, `ride`, `scan`, `auth`, `account` (history, plans), `fleet` (DTOs and query), `location`.
- `src/shared/` — API client and formatters. `src/styles/app.css` holds all styles, organised by layer with tokens on `:root` and a dark scheme.
- TanStack Query owns server state; Zustand only holds ephemeral UI state.

## Map

- Mapbox GL via `react-map-gl/mapbox`, Mapbox Standard style imported as `basemap` (`faded` theme, `night` preset in dark mode).
- The token comes from `VITE_MAPBOX_ACCESS_TOKEN` in `apps/web/.env.local` (see `.env.example`). Never commit a token.
- Marker clicks must use `Marker`'s `onClick` and stop `originalEvent`; React's synthetic `stopPropagation` does not stop the map's click.
- Keep the Mapbox logo and attribution visible (they move under the top bar on phones and beside the panel on desktop).

## API

- The browser calls `/v1/*` on its own origin. Vite proxies it in development (`OLOWO_API_ORIGIN`, default `http://127.0.0.1:8787`); Caddy (`apps/web/Caddyfile`, `compose.yaml`) proxies it in production. This keeps the HttpOnly session cookie first-party.

## Validation

- `pnpm --filter @olowo/web build` — type-check and production build.
- `pnpm --filter @olowo/web test:e2e` — Playwright on a phone and a desktop viewport. The suite stubs the olowo API and Mapbox, so it never calls Mapbox or mutates a real scooter. `OLOWO_REAL_TILES=1` swaps in OSM imagery for visual review screenshots under `test-results/`.
- `pnpm --filter @olowo/web test:sites` — worker routing (run after a build).

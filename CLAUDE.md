# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Phase 0 scaffolding is in. `requirement.md` is the authoritative spec; the NestJS project under `src/` implements Phase 1 §6.

## Commands

```bash
npm install                                              # first time / after deps change
cp .env.example .env                                     # runtime knobs (PORT, TZ, FRONTEND_ORIGINS, USE_GCP_SECRETS)
cp route-to-office.example.json route-to-office.json     # then fill in your own low-quota dev keys
npm run start:dev        # watch mode, http://localhost:3000, Swagger at /docs
npm run build            # compile to dist/
npm run start:prod       # run the compiled build
npm run lint             # eslint --fix on src/ and test/
npm test                 # jest (no specs written yet)
```

Docker: `docker build -t route-to-office .` — multi-stage build defined in `Dockerfile`, sized for Google Cloud Run (`PORT=8080`, `TZ=Asia/Bangkok`). The `requirement.md` §10 App Runner playbook is superseded by the Cloud Run steps in `README.md` — treat the README as canonical for deploy.

By default the app reads secrets from `route-to-office.json` at the project root (override with `SECRETS_FILE`). Set `USE_GCP_SECRETS=true` (plus `GCP_SECRET_NAME`, and `GCP_PROJECT_ID` when not running on Cloud Run itself) to switch to Google Cloud Secret Manager. The JSON shape mirrors the Secret Manager payload 1:1, so toggling modes is just a flag flip. If any required key is missing at boot, the process logs the offending key and exits with code 1 — see `src/config/secrets.loader.ts`.

## What this backend does

A single-purpose HTTP API for a public web page that shows a driving route from the visitor's current location to a single, fixed company office. Sized for tens of users, one Cloud Run instance, no auth.

The frontend is a separate project. This repo only covers steps 3–7 of the flow in `requirement.md` §3: receive the visitor's coordinates, call Google Routes API, return distance/duration/polyline.

## Architecture — the non-obvious constraints

These decisions are load-bearing across the codebase. Read `requirement.md` for full rationale before deviating.

- **Two Google API keys, two different threat models.** The *server key* (Routes + Geocoding) must never reach the browser and is loaded from Google Cloud Secret Manager. The *browser key* (Maps JS API) is served to the frontend via `GET /api/config` and is protected by HTTP-referrer restrictions instead of secrecy. Never merge these code paths.
- **The destination is server-side only.** The client sends only its own `{lat, lng}`; the office coordinates come from `CompanyService`, which reads from in-memory config loaded at boot. This is what stops the endpoint from being abused as a free routing service between arbitrary points.
- **`CompanyService` is the single source of truth for office coordinates.** All other code injects it. When multi-branch / admin-edit lands (Phase 2), only the inside of that service changes.
- **Secret Manager is read once, at startup, via `ConfigModule.forRootAsync()`** — never per request. Validate all keys immediately after load; exit the process on missing/invalid values. Local dev falls back to `route-to-office.json` when `USE_GCP_SECRETS !== 'true'`.
- **In-memory cache, single instance, on purpose.** Cloud Run `--min-instances=1 --max-instances=1`. Cache key is `route:<lat 3dp>:<lng 3dp>:<floor(epoch/300)>`, TTL 5 min. If scaling to >1 instance is ever needed, swap the cache implementation to Redis (Memorystore) — don't run the current cache across instances (hit rate collapses, results diverge). Do not use `--min-instances=0`: the cold-start cache drop makes every first request pay full Routes API cost.
- **Traffic-aware routing requires all three of `departureTime` (RFC 3339, now), `routingPreference: TRAFFIC_AWARE_OPTIMAL`, `travelMode: DRIVE`** sent together to Routes API `computeRoutes`. Omitting any one silently returns a static estimate. Also pin the `X-Goog-FieldMask` header (see §4) — do not request `routes.legs`.
- **Formatting lives on the backend.** Responses ship both raw numbers and a human-readable `text` (`"12.4 km"`, `"1 hr 15 min"`). Frontend does zero formatting; the display rules can change without a frontend deploy.
- **Never surface Google's error text.** A global exception filter maps upstream failures to the fixed status/message table in `requirement.md` §7 (422 / 404 / 502 / 504 / 429). User-facing `message` is display-ready.
- **PDPA:** never persist visitor coordinates, and round to 2 decimals before logging. Coordinates are personal data.
- **Set `TZ=Asia/Bangkok`** on Cloud Run (baked into the Dockerfile, also passed via `--set-env-vars` so it shows in the console). `computedAt` and logs are expected in local time; Google itself is timezone-agnostic for `departureTime`.
- **`app.set('trust proxy', 1)`** is required for `@nestjs/throttler` to see the real client IP behind Cloud Run's front-end proxy.

## Target project layout

Defined in `requirement.md` §6. Reproduce it when scaffolding:

```
src/
├── main.ts
├── app.module.ts
├── config/         # secrets.service.ts + config.module.ts
├── route/          # POST /api/route + DTOs
├── company/        # GET /api/company, GET /api/config, CompanyService
├── google/         # routes-client.service.ts (only place that calls Google)
├── common/         # exception filter, units formatter
└── health/         # GET /healthz
```

Endpoints (contract is frozen once handed to frontend — see §6):

| Method | Path | |
| --- | --- | --- |
| GET | `/api/config` | Browser key for Maps JS |
| GET | `/api/company` | Office name/address/coords |
| POST | `/api/route` | `{lat,lng}` → distance/duration/polyline (see §6 for exact response shape) |
| GET | `/healthz` | Cloud Run health check |

Validation uses global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true`. Extra fields on `POST /api/route` must be rejected, not ignored.

## Deployment gotcha worth calling out

Cloud Run also has two identities to keep straight: the **build-time SA** (Cloud Build) and the **runtime SA** (passed via `--service-account` on `gcloud run deploy`). `roles/secretmanager.secretAccessor` **must** be on the *runtime* SA, granted on the specific secret — not on the Cloud Build SA. Missing this binding deploys cleanly and then crashes on first request with `PERMISSION_DENIED` from Secret Manager, which is hard to diagnose because IAM in the console "looks right." Full deploy steps live in `README.md`.

Each environment (staging, prod) is a separate Cloud Run service (`route-to-office-staging`, `route-to-office-prod`) backed by its own secret (`route-to-office-staging`, `route-to-office-prod`) and its own scoped IAM binding — keep the blast radius per environment.

## Where to look for more detail

`requirement.md` is the authoritative spec. Section map:

- §3 System architecture, key separation, data flow
- §4 Google APIs, required parameters, field mask
- §5 Secret store layout and loader behavior (loader now uses Google Cloud Secret Manager — see `src/config/secrets.loader.ts` and `README.md` deploy section)
- §6 NestJS structure, packages, endpoints, DTOs, validation
- §7 Error mapping table and timeouts
- §8 Cache, rate-limit, security headers, PDPA
- §10 App Runner deployment, IAM, checklist — **superseded** by the Cloud Run steps in `README.md` (kept for historical reference)
- §12 Open decisions still unresolved

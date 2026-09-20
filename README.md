# route-to-office

Backend API for the **Route to Office** web app. A public web page shows a driving route from the visitor's current location to a single fixed company office; this repo handles steps 3–7 of that flow — receive the visitor's coordinates, call Google Routes API, return distance / duration / polyline.

- **Framework:** NestJS 10 (Express), TypeScript
- **Runtime target:** AWS App Runner, single instance (min = max = 1)
- **Frontend:** ships from `web/` (Vite + TS), served as static files by the same Nest process
- **Auth:** none (public endpoint, rate-limited)
- **Spec:** `requirement.md` is authoritative. `CLAUDE.md` captures the load-bearing decisions.

## Quick start

```bash
npm install
cp .env.example .env      # fill in low-quota dev keys + office coords
npm run start:dev         # http://localhost:3000, Swagger at /docs
```

Frontend (optional in dev):

```bash
npm --prefix web install
npm --prefix web run dev  # Vite dev server on :5173, calls API on :3000
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | Nest in watch mode |
| `npm run build` | Compile backend to `dist/` |
| `npm run build:web` | Build the frontend into `web/dist/` |
| `npm run build:all` | Both of the above |
| `npm run start:prod` | Run compiled build (`node dist/main`) |
| `npm run lint` | `eslint --fix` on `src/` and `test/` |
| `npm test` | Jest (no specs yet) |

## Configuration

Secrets are loaded once at boot by `src/config/secrets.loader.ts`. Missing/invalid keys log the offending name and exit with code 1.

- Default: read from `.env` (see `.env.example`).
- Set `USE_AWS_SECRETS=true` (plus `AWS_REGION`, `AWS_SECRET_NAME`) to switch to AWS Secrets Manager.

Required keys:

| Key | Notes |
| --- | --- |
| `GOOGLE_MAPS_SERVER_KEY` | Routes + Geocoding. **Never sent to the browser.** |
| `GOOGLE_MAPS_BROWSER_KEY` | Maps JS API. Served via `GET /api/config`, protected by HTTP-referrer restrictions. |
| `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_LAT`, `COMPANY_LNG` | Fixed office (single office in Phase 1). |
| `COMPANY_PLACE_ID` | Optional; enables entrance-accurate routing. |
| `FRONTEND_ORIGINS` | Comma-separated allowed origins for CORS + `/api/config` origin check. |
| `PORT`, `TZ` | `TZ=Asia/Bangkok` is expected in prod. |

> The **two Google keys have different threat models** — the server key stays secret, the browser key is protected by referrer restrictions. Never merge those code paths.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Browser key for the Maps JS SDK |
| `GET` | `/api/company` | Office name / address / coords |
| `POST` | `/api/route` | `{ lat, lng }` → distance / duration / polyline |
| `GET` | `/healthz` | App Runner health check |
| `GET` | `/docs` | Swagger UI |

`POST /api/route` uses a global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true` — extra fields are rejected, not silently dropped. The response shape (frozen once handed to frontend) is defined in `requirement.md` §6.

## Architecture — non-obvious constraints

Skim these before changing anything under `src/`. Full rationale lives in `requirement.md` and `CLAUDE.md`.

- **Destination is server-side only.** Clients send only their own `{lat, lng}`; `CompanyService` supplies the office coordinates. Stops the endpoint from being abused as a free routing service.
- **`CompanyService` is the single source of truth** for office coordinates. Multi-branch / admin-edit (Phase 2) only changes the inside of that service.
- **In-memory cache, single instance, on purpose.** Key: `route:<lat 3dp>:<lng 3dp>:<floor(epoch/300)>`, TTL 5 min. Scaling out > 1 instance requires swapping the cache to Redis (hit rate would otherwise collapse).
- **Traffic-aware routing needs all three**: `departureTime` (RFC 3339, now) + `routingPreference: TRAFFIC_AWARE_OPTIMAL` + `travelMode: DRIVE`. Missing any one silently returns a static estimate. Pin `X-Goog-FieldMask` (see §4); do not request `routes.legs`.
- **Formatting lives on the backend.** Responses ship both raw numbers and human-readable `text` (`"12.4 km"`, `"1 hr 15 min"`). Display rules can change without a frontend deploy.
- **Never surface Google's error text.** The global exception filter maps upstream failures to the fixed table in `requirement.md` §7 (422 / 404 / 502 / 504 / 429). User-facing `message` is display-ready.
- **PDPA.** Never persist visitor coordinates. Round to 2 decimals before logging.
- **`app.set('trust proxy', 1)`** is required for `@nestjs/throttler` to see real client IPs behind the App Runner proxy.

## Project layout

```
src/
├── main.ts              # bootstrap, helmet, CORS, ValidationPipe, Swagger
├── app.module.ts        # ConfigModule first, Throttler, Cache, ServeStatic
├── config/              # secrets loader (env or AWS Secrets Manager)
├── route/               # POST /api/route + DTOs
├── company/             # GET /api/company, GET /api/config, CompanyService
├── google/              # routes-client.service.ts — the only Google caller
├── common/              # exception filter, formatters, guards
└── health/              # GET /healthz
web/                     # Vite + TS frontend, built into web/dist/
```

## Docker

```bash
docker build -t route-to-office .
```

Multi-stage: stage 1 builds `web/dist/`, stage 2 compiles the backend, stage 3 ships `dist/` + `web/dist/` + prod deps only. No secrets pass through `ARG`/`ENV`; they are read from Secrets Manager at runtime.

## App Runner deployment gotchas

- Two IAM roles exist: an **access role** (pulls the image) and an **instance role** (used by the running process). `secretsmanager:GetSecretValue` **must** be on the *instance* role. Attaching it to the access role deploys cleanly, then crashes at boot with `AccessDenied`.
- Each environment is a separate App Runner service with its own secret ARN (`route-to-office/staging`, `route-to-office/prod`) and its own scoped instance role.
- Set `TZ=Asia/Bangkok`. `computedAt` and logs are expected in local time.

Full deploy checklist: `requirement.md` §10.

## Where to look next

- `requirement.md` §3 — architecture, key separation, data flow
- `requirement.md` §4 — Google APIs, required params, field mask
- `requirement.md` §6 — endpoints, DTOs, validation, response shapes
- `requirement.md` §7 — error mapping table and timeouts
- `requirement.md` §8 — cache, rate-limit, security headers, PDPA
- `requirement.md` §10 — App Runner deployment
- `requirement.md` §12 — open decisions
- `CLAUDE.md` — condensed rules for anyone (human or agent) editing this repo

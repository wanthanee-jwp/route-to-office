# route-to-office

Backend API for the **Route to Office** web app. A public web page shows a driving route from the visitor's current location to a single fixed company office; this repo handles steps 3–7 of that flow — receive the visitor's coordinates, call Google Routes API, return distance / duration / polyline.

- **Framework:** NestJS 10 (Express), TypeScript
- **Runtime target:** Google Cloud Run, single instance (min = max = 1)
- **Frontend:** ships from `web/` (Vite + TS), served as static files by the same Nest process
- **Auth:** none (public endpoint, rate-limited)
- **Spec:** `requirement.md` is authoritative. `CLAUDE.md` captures the load-bearing decisions. Section §10 (AWS App Runner) is superseded by the Cloud Run deploy below.

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

- Default: read from `route-to-office.json` at the project root (copy `route-to-office.example.json`).
- Set `USE_GCP_SECRETS=true`, `GCP_PROJECT_ID`, and `GCP_SECRET_NAME` to switch to Google Cloud Secret Manager. All three are required — Cloud Run does **not** inject `GOOGLE_CLOUD_PROJECT` automatically (that's App Engine / Cloud Functions behavior), so `GCP_PROJECT_ID` must be passed explicitly via `--set-env-vars`.

Required keys:

| Key | Notes |
| --- | --- |
| `GOOGLE_MAPS_SERVER_KEY` | Routes + Geocoding. **Never sent to the browser.** |
| `GOOGLE_MAPS_BROWSER_KEY` | Maps JS API. Served via `GET /api/config`, protected by HTTP-referrer restrictions. |
| `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_LAT`, `COMPANY_LNG` | Fixed office (single office in Phase 1). |
| `COMPANY_PLACE_ID` | Optional; enables entrance-accurate routing. |
| `FRONTEND_ORIGINS` | Comma-separated allowed origins for CORS + `/api/config` origin check. |
| `PORT`, `TZ` | `TZ=Asia/Bangkok` is expected in prod. Cloud Run injects `PORT` automatically (defaults to `8080`). |

> The **two Google keys have different threat models** — the server key stays secret, the browser key is protected by referrer restrictions. Never merge those code paths.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Browser key for the Maps JS SDK |
| `GET` | `/api/company` | Office name / address / coords |
| `POST` | `/api/route` | `{ lat, lng }` → distance / duration / polyline |
| `GET` | `/health` | Cloud Run health check (path is `/health` — Cloud Run reserves `/healthz` at the edge) |
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
- **`app.set('trust proxy', 1)`** is required for `@nestjs/throttler` to see real client IPs behind the Cloud Run front-end proxy.

## Project layout

```
src/
├── main.ts              # bootstrap, helmet, CORS, ValidationPipe, Swagger
├── app.module.ts        # ConfigModule first, Throttler, Cache, ServeStatic
├── config/              # secrets loader (local JSON or Google Cloud Secret Manager)
├── route/               # POST /api/route + DTOs
├── company/             # GET /api/company, GET /api/config, CompanyService
├── google/              # routes-client.service.ts — the only Google caller
├── common/              # exception filter, formatters, guards
└── health/              # GET /health
web/                     # Vite + TS frontend, built into web/dist/
```

## Docker

```bash
docker build -t route-to-office .
```

Multi-stage: stage 1 builds `web/dist/`, stage 2 compiles the backend, stage 3 ships `dist/` + `web/dist/` + prod deps only. No secrets pass through `ARG`/`ENV`; they are read from Secret Manager at runtime.

## Deploy to Google Cloud Run

The runtime service account needs `roles/secretmanager.secretAccessor` on the target secret. Cloud Run injects `GOOGLE_CLOUD_PROJECT` and `PORT` automatically, so the container only needs `USE_GCP_SECRETS=true` and the secret name.

### One-time setup per project

```bash
export PROJECT_ID=your-gcp-project
export REGION=asia-southeast1
export ENV=staging   # or prod

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com

# Artifact Registry repo for the image
gcloud artifacts repositories create route-to-office \
  --repository-format=docker --location="$REGION"

# Runtime service account (least privilege — no owner/editor)
gcloud iam service-accounts create route-to-office \
  --display-name="Route to Office runtime"

# Store the JSON payload — same shape as route-to-office.example.json
gcloud secrets create "route-to-office-$ENV" \
  --replication-policy=user-managed --locations="$REGION"
gcloud secrets versions add "route-to-office-$ENV" --data-file=route-to-office.json

# Grant the runtime SA read-only access to the secret
gcloud secrets add-iam-policy-binding "route-to-office-$ENV" \
  --member="serviceAccount:route-to-office@$PROJECT_ID.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

### Deploy

Simplest — let Cloud Build package and deploy in one shot:

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_SERVICE=route-to-office-$ENV,_SECRET_NAME=route-to-office-$ENV,\
_RUNTIME_SA=route-to-office@$PROJECT_ID.iam.gserviceaccount.com,\
_FRONTEND_ORIGINS=https://your-frontend.example.com
```

Or manually with `gcloud run deploy`:

```bash
gcloud run deploy route-to-office-$ENV \
  --source . \
  --region="$REGION" \
  --service-account="route-to-office@$PROJECT_ID.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --min-instances=1 --max-instances=1 \
  --cpu=1 --memory=512Mi --port=8080 --timeout=30s \
  --set-env-vars=USE_GCP_SECRETS=true,GCP_PROJECT_ID=$PROJECT_ID,GCP_SECRET_NAME=route-to-office-$ENV,TZ=Asia/Bangkok,FRONTEND_ORIGINS=https://your-frontend.example.com
```

### Cloud Run gotchas

- **`secretmanager.secretAccessor` goes on the runtime service account** — the one passed via `--service-account`. Cloud Build's SA only needs to build/push and (if it deploys) `run.developer` + `iam.serviceAccountUser` on the runtime SA. Skipping the runtime binding deploys cleanly and then crashes on first request with `PERMISSION_DENIED` from Secret Manager.
- **Set `--min-instances=1`** to keep the in-memory route cache warm. `min=0` (scale-to-zero) works but every cold start drops the cache and pays the full Routes API call again.
- **Set `--max-instances=1`** for as long as the cache lives in memory. Scaling beyond one instance splits the cache across replicas — swap to Redis first (see the cache note above).
- **Do not use `--set-secrets`** for our Google API keys / company data. The loader expects a single JSON payload it reads via the Secret Manager client library. `--set-secrets` mounts each secret as its own env var, which is a different model.
- **One secret per environment** (`route-to-office-staging`, `route-to-office-prod`), each with its own IAM binding — keeps blast radius tight.
- **`TZ=Asia/Bangkok`** is baked into the Dockerfile but also passed as an env var so the setting is visible in the Cloud Run console.

## Where to look next

- `requirement.md` §3 — architecture, key separation, data flow
- `requirement.md` §4 — Google APIs, required params, field mask
- `requirement.md` §6 — endpoints, DTOs, validation, response shapes
- `requirement.md` §7 — error mapping table and timeouts
- `requirement.md` §8 — cache, rate-limit, security headers, PDPA
- `requirement.md` §10 — App Runner deployment
- `requirement.md` §12 — open decisions
- `CLAUDE.md` — condensed rules for anyone (human or agent) editing this repo

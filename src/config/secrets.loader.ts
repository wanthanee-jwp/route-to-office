import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Local dev reads secrets from this JSON file at the project root. The shape
// matches the Google Secret Manager payload 1:1, so switching between modes is
// literally just USE_GCP_SECRETS=true|false. Override the path with
// SECRETS_FILE if you need a non-default location.
const DEFAULT_SECRETS_FILE = 'route-to-office.json';

// The keys held in Secret Manager (requirement.md §5). Everything else — port,
// TZ, FRONTEND_ORIGINS — comes from ordinary env vars and is not a secret.
export const SECRET_KEYS = [
  'GOOGLE_MAPS_SERVER_KEY',
  'GOOGLE_MAPS_BROWSER_KEY',
  'COMPANY_NAME',
  'COMPANY_ADDRESS',
  'COMPANY_LAT',
  'COMPANY_LNG',
] as const;

// Optional keys — loaded and passed through to process.env when present, but
// their absence does not fail startup.
//   COMPANY_PLACE_ID: improves routing accuracy (Google can target the
//     building entrance instead of a rooftop pin); the Routes call still
//     works with lat/lng alone.
//   FRONTEND_ORIGINS: convenience passthrough so route-to-office.json can act
//     as a single local-config file. If absent from the payload, main.ts falls
//     back to whatever is in .env / shell env.
export const OPTIONAL_SECRET_KEYS = ['COMPANY_PLACE_ID', 'FRONTEND_ORIGINS'] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type OptionalSecretKey = (typeof OPTIONAL_SECRET_KEYS)[number];
export type SecretValues = Record<SecretKey, string> &
  Partial<Record<OptionalSecretKey, string>>;

// Loads secret values either from Google Cloud Secret Manager or from the
// local route-to-office.json file. This runs once during ConfigModule
// bootstrap; if it throws, Nest never finishes starting and the container
// fails fast — which is exactly what we want if a required key is missing.
export async function loadSecrets(): Promise<SecretValues> {
  const useGcp = (process.env.USE_GCP_SECRETS ?? '').toLowerCase() === 'true';
  const raw: Record<string, string | undefined> = useGcp
    ? await fetchFromGcp()
    : await fetchFromFile();

  const values = validate(raw);
  // Fold the resolved values back into process.env so @nestjs/config's
  // ConfigService can read them uniformly through get('KEY').
  for (const key of SECRET_KEYS) {
    process.env[key] = values[key];
  }
  for (const key of OPTIONAL_SECRET_KEYS) {
    const value = values[key];
    if (value !== undefined) process.env[key] = value;
  }
  return values;
}

async function fetchFromFile(): Promise<Record<string, string>> {
  const path = resolve(process.cwd(), process.env.SECRETS_FILE ?? DEFAULT_SECRETS_FILE);
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `Secrets file not found at ${path}. Copy route-to-office.example.json to route-to-office.json (or set SECRETS_FILE).`,
      );
    }
    throw new Error(`Failed to read secrets file ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(`Secrets file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Secrets file ${path} must contain a JSON object`);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

async function fetchFromGcp(): Promise<Record<string, string>> {
  // Cloud Run does NOT inject GOOGLE_CLOUD_PROJECT (that's App Engine / Cloud
  // Functions behavior). Deploy scripts must pass GCP_PROJECT_ID explicitly.
  // GOOGLE_CLOUD_PROJECT is still honored as a fallback for other environments.
  const projectId = process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const secretName = process.env.GCP_SECRET_NAME;
  const version = process.env.GCP_SECRET_VERSION ?? 'latest';
  if (!projectId) {
    throw new Error(
      'GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) must be set when USE_GCP_SECRETS=true',
    );
  }
  if (!secretName) {
    throw new Error('GCP_SECRET_NAME must be set when USE_GCP_SECRETS=true');
  }

  // Uses Application Default Credentials — on Cloud Run this is the runtime
  // service account attached to the service. Locally it's whatever
  // `gcloud auth application-default login` set up.
  const client = new SecretManagerServiceClient();
  const resourceName = `projects/${projectId}/secrets/${secretName}/versions/${version}`;

  const [response] = await client.accessSecretVersion({ name: resourceName });
  const payload = response.payload?.data;
  if (!payload) {
    throw new Error(`Secret ${resourceName} has no payload`);
  }
  const decoded = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (err) {
    throw new Error(
      `Secret ${resourceName} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Secret ${resourceName} did not decode to a JSON object`);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

function validate(raw: Record<string, string | undefined>): SecretValues {
  const missing: string[] = [];
  const out: Partial<SecretValues> = {};

  for (const key of SECRET_KEYS) {
    const value = raw[key];
    if (value === undefined || value === '') {
      missing.push(key);
    } else {
      out[key] = value;
    }
  }

  for (const key of OPTIONAL_SECRET_KEYS) {
    const value = raw[key];
    if (value !== undefined && value !== '') {
      out[key] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required secret values: ${missing.join(', ')}`);
  }

  const lat = Number(out.COMPANY_LAT);
  const lng = Number(out.COMPANY_LNG);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`COMPANY_LAT out of range (-90..90): ${out.COMPANY_LAT}`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`COMPANY_LNG out of range (-180..180): ${out.COMPANY_LNG}`);
  }

  return out as SecretValues;
}

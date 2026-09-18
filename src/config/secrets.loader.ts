import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

// The keys held in Secrets Manager (requirement.md §5). Everything else — port,
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
// their absence does not fail startup. COMPANY_PLACE_ID improves routing
// accuracy (Google can target the building entrance instead of a rooftop pin)
// but the Routes call still works with lat/lng alone.
export const OPTIONAL_SECRET_KEYS = ['COMPANY_PLACE_ID'] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type OptionalSecretKey = (typeof OPTIONAL_SECRET_KEYS)[number];
export type SecretValues = Record<SecretKey, string> &
  Partial<Record<OptionalSecretKey, string>>;

// Loads secret values either from AWS Secrets Manager or from process.env
// (populated from .env). This runs once during ConfigModule bootstrap; if it
// throws, Nest never finishes starting and the container fails fast — which is
// exactly what we want if a required key is missing.
export async function loadSecrets(): Promise<SecretValues> {
  const useAws = (process.env.USE_AWS_SECRETS ?? '').toLowerCase() === 'true';
  const raw: Record<string, string | undefined> = useAws
    ? await fetchFromAws()
    : { ...process.env };

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

async function fetchFromAws(): Promise<Record<string, string>> {
  const region = process.env.AWS_REGION;
  const secretId = process.env.AWS_SECRET_NAME;
  if (!region) throw new Error('AWS_REGION must be set when USE_AWS_SECRETS=true');
  if (!secretId) throw new Error('AWS_SECRET_NAME must be set when USE_AWS_SECRETS=true');

  // 5s per attempt, 3 attempts total (requirement.md §7).
  const client = new SecretsManagerClient({
    region,
    requestHandler: { requestTimeout: 5_000 },
    maxAttempts: 3,
  });

  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) {
    throw new Error(`Secret ${secretId} has no SecretString payload`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.SecretString);
  } catch (err) {
    throw new Error(`Secret ${secretId} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Secret ${secretId} did not decode to an object`);
  }
  return parsed as Record<string, string>;
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

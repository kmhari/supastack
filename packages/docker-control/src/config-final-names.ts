/**
 * Short-key → final container env-name resolution for honored config fields
 * (feature 124).
 *
 * Most honored fields in the api's env-field-mapper already carry their final
 * GoTrue/PostgREST env name (`GOTRUE_MAILER_SUBJECTS_CONFIRMATION`). Sixteen do
 * not: they carry a short key (`SITE_URL`, `SMTP_PASS`) that today is translated
 * to the GoTrue name *inside the compose `environment:` block*
 * (`GOTRUE_SITE_URL: ${SITE_URL}`).
 *
 * Feature 124 delivers honored fields through a raw env_file instead of that
 * block, so the file must carry the FINAL names — env_file injects keys
 * verbatim, there is no translation step left. This table restores the
 * translation the `environment:` block used to perform.
 *
 * The table was extracted directly from `infra/supabase-template/docker-compose.yml`
 * (`GOTRUE_X: ${SHORT}` lines), restricted to the honored set. Sixteen of these
 * are credentials and core auth toggles — SMTP_PASS, SMTP_HOST, SITE_URL — where
 * a wrong name silently breaks a tenant's email or sign-in. A contract test in
 * the api package asserts every honored short key has an entry here.
 */

/** Short `.env` key → final container env name. Only the 16 that differ. */
export const HONORED_SHORT_TO_FINAL: Readonly<Record<string, string>> = {
  ADDITIONAL_REDIRECT_URLS: 'GOTRUE_URI_ALLOW_LIST',
  DISABLE_SIGNUP: 'GOTRUE_DISABLE_SIGNUP',
  ENABLE_ANONYMOUS_USERS: 'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED',
  ENABLE_EMAIL_AUTOCONFIRM: 'GOTRUE_MAILER_AUTOCONFIRM',
  ENABLE_EMAIL_SIGNUP: 'GOTRUE_EXTERNAL_EMAIL_ENABLED',
  ENABLE_PHONE_AUTOCONFIRM: 'GOTRUE_SMS_AUTOCONFIRM',
  ENABLE_PHONE_SIGNUP: 'GOTRUE_EXTERNAL_PHONE_ENABLED',
  JWT_EXPIRY: 'GOTRUE_JWT_EXP',
  SECURITY_MANUAL_LINKING_ENABLED: 'GOTRUE_SECURITY_MANUAL_LINKING_ENABLED',
  SITE_URL: 'GOTRUE_SITE_URL',
  SMTP_ADMIN_EMAIL: 'GOTRUE_SMTP_ADMIN_EMAIL',
  SMTP_HOST: 'GOTRUE_SMTP_HOST',
  SMTP_PASS: 'GOTRUE_SMTP_PASS',
  SMTP_PORT: 'GOTRUE_SMTP_PORT',
  SMTP_SENDER_NAME: 'GOTRUE_SMTP_SENDER_NAME',
  SMTP_USER: 'GOTRUE_SMTP_USER',
};

/**
 * Resolve a honored field's `envName` (as stored in the api mapper) to the name
 * the container must receive. Already-final names (`GOTRUE_…`, `PGRST_…`) pass
 * through unchanged; the 16 short keys are translated.
 *
 * PostgREST honored fields (`PGRST_DB_SCHEMAS`, …) are already final and pass
 * through — they are consumed by the `rest` service, which gets the same raw
 * env_file treatment.
 */
export function resolveFinalEnvName(mapperEnvName: string): string {
  return HONORED_SHORT_TO_FINAL[mapperEnvName] ?? mapperEnvName;
}

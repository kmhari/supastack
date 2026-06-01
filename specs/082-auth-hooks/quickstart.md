# Quickstart: Auth Hooks (pg-functions:// — Phase 1)

## What this does

Enables supastack operators to attach GoTrue auth hooks to their projects using Postgres functions. Seven hook types are supported:

| Hook | When it fires |
|---|---|
| `custom_access_token` | Before GoTrue issues a JWT |
| `mfa_verification_attempt` | When a user attempts MFA |
| `password_verification_attempt` | When a user enters their password |
| `send_email` | Before GoTrue sends an auth email |
| `send_sms` | Before GoTrue sends an auth SMS |
| `before_user_created` | Before a new user record is created |
| `after_user_created` | After a new user record is created |

---

## Step 1: Write your Postgres function

In your project's SQL editor (or `supabase db push`), create a function matching the hook's expected signature. Example for `custom_access_token`:

```sql
CREATE OR REPLACE FUNCTION public.my_custom_jwt(event jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  claims jsonb;
BEGIN
  claims := event -> 'claims';
  claims := jsonb_set(claims, '{custom_claim}', 'true');
  RETURN jsonb_build_object('claims', claims);
END;
$$;
```

See [GoTrue hook docs](https://supabase.com/docs/guides/auth/auth-hooks) for the full event/response shape per hook type.

---

## Step 2: Enable the hook in the dashboard

1. Go to **Authentication → Hooks** for your project.
2. Find the hook type you want (e.g., "Custom Access Token").
3. Toggle **Enabled** on.
4. Enter the URI: `pg-functions://postgres/public/my_custom_jwt`
5. (Optional) Enter a signing secret if your function verifies the webhook signature.
6. Click **Save**. A toast shows "Restarting auth — ~30s". Wait for the success notification.

---

## Step 3: Verify

Sign in as any user in your project. Decode the issued JWT — your custom claim should be present.

Using the Supabase CLI:
```bash
# Link your project
supabase link --project-ref <ref>

# Run a quick test via db query
supabase db query "SELECT auth.sign_in_with_password('test@example.com', 'password');"
```

Or use `supabase functions serve` with a test invocation that triggers sign-in and inspects the JWT payload.

---

## Limitations (Phase 1)

- Only `pg-functions://` URIs are accepted. HTTPS hook endpoints are tracked in [issue #64](https://github.com/your-org/supastack/issues/64) as Phase 2.
- Secrets stored in the hook config are encrypted at rest but are not vault-managed. Vault migration tracked in [issue #70](https://github.com/your-org/supastack/issues/70).
- The platform does not validate that the plpgsql function exists at save time. A missing function causes GoTrue to log an error at dispatch time.

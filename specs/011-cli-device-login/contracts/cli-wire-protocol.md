# Contract — Upstream CLI wire protocol reference

**Purpose**: Single source of truth for the wire-level constraints we must conform to. Pulled verbatim from the upstream supabase CLI on `develop`. ANY drift here breaks `supabase login`.

**Upstream source**: `https://raw.githubusercontent.com/supabase/cli/develop/apps/cli-go/internal/login/login.go`

---

## Browser URL the CLI opens

```
<dashboard_url>/cli/login?session_id=<uuid>&token_name=<name>&public_key=<hex>
```

Constructed at lines 191–194:

```go
encodedPublicKey := params.Encryption.encodedPublicKey()
createLoginSessionPath := "/cli/login"
createLoginSessionQuery := "?session_id=" + params.SessionId + "&token_name=" + params.TokenName + "&public_key=" + encodedPublicKey
createLoginSessionUrl := utils.GetSupabaseDashboardURL() + createLoginSessionPath + createLoginSessionQuery
```

**For supastack**: `<dashboard_url>` = `https://<apex>/dashboard`, so the full URL is `https://<apex>/dashboard/cli/login?session_id=…&token_name=…&public_key=…`. Note: NOT url-encoded by the CLI; the raw values are appended directly. Our dashboard MUST tolerate unencoded `+`, `@`, `_`, etc. in `token_name`.

## Polling URL

```
<api_url>/platform/cli/login/<session_id>?device_code=<8-hex>
```

Constructed at lines 213 + 142:

```go
sessionPollingUrl := "/platform/cli/login/" + params.SessionId
...
urlWithQuery := fmt.Sprintf("%s?device_code=%s", url, deviceCode)
resp, err := client.Send(ctx, http.MethodGet, urlWithQuery, nil)
```

**For supastack**: `<api_url>` = `https://api.<apex>`. The CLI uses the api_url from its profile, polls with `GET`. No request body, no auth header.

## Response shape (CLI expects exactly this)

Lines 38–44:

```go
type AccessTokenResponse struct {
    SessionId   string `json:"id"`
    CreatedAt   string `json:"created_at"`
    AccessToken string `json:"access_token"`
    PublicKey   string `json:"public_key"`
    Nonce       string `json:"nonce"`
}
```

JSON example:

```json
{
  "id": "21f7bcf6-d8a6-43a0-b9d7-74f568073cf5",
  "created_at": "2026-05-25T13:30:00.000Z",
  "access_token": "...hex...",
  "public_key": "04...hex...",
  "nonce": "...hex..."
}
```

## Decryption (what the CLI does)

Lines 86–127 (`decryptAccessToken`):

```go
decodedAccessToken, _ := hex.DecodeString(accessToken)
decodedNonce, _       := hex.DecodeString(nonce)
decodedPublicKey, _   := hex.DecodeString(publicKey)
remotePublicKey, _    := enc.curve.NewPublicKey(decodedPublicKey)
secret, _             := enc.privateKey.ECDH(remotePublicKey)  // 32 bytes
block, _              := aes.NewCipher(secret)                  // AES-256 (key length determines variant)
aesgcm, _             := cipher.NewGCM(block)
plaintext, _          := aesgcm.Open(nil, decodedNonce, decodedAccessToken, nil)
```

**Critical implementation detail**: Go's `aesgcm.Open(dst, nonce, ciphertext, additionalData)` expects `ciphertext` = `actual_ct || 16-byte_auth_tag`. The Open function:
- Takes the LAST 16 bytes as the auth tag
- Decrypts the remaining bytes
- Verifies the tag against the AD (nil here) + ciphertext

**Implication for our Node implementation**: When we encrypt with `crypto.createCipheriv('aes-256-gcm', …)`, we MUST concat the auth tag (`cipher.getAuthTag()`, 16 bytes) AFTER the ciphertext bytes BEFORE hex-encoding:

```ts
const ct  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();   // 16 bytes
const accessTokenHex = Buffer.concat([ct, tag]).toString('hex');   // ← match Go's Seal output format
```

If we don't concatenate the tag, the CLI's `Open` will treat the last 16 bytes of the ciphertext as the tag → auth-verification failure → "cannot decrypt access token".

## Public key encoding

Lines 80–84:

```go
func (enc LoginEncryption) encodedPublicKey() string {
    return hex.EncodeToString(enc.publicKey.Bytes())
}
```

Go's `ecdh.PublicKey.Bytes()` returns the uncompressed SEC1 format: `04 || X (32 bytes) || Y (32 bytes)` = 65 bytes. Hex-encoded = 130 chars.

**For our server-side public_key**: Node's `ecdh.getPublicKey()` (no encoding arg, or `'raw'` arg) returns the same uncompressed 65-byte SEC1 format. Hex-encode for the response — no special handling needed.

## Verification code prompt (CLI side)

Lines 141 + the surrounding code:

```go
deviceCode, err := console.PromptText(ctx, "Enter your verification code: ")
```

The CLI prompts the operator for a string and uses it verbatim in the URL query. So:
- Whatever string our dashboard displays, the operator pastes; the CLI URL-encodes it; we receive it via `req.query.device_code`
- Our 8-hex-char format is safe (URL-safe characters)
- CLI retries up to `maxRetries = 2` times (`backoff.WithMaxRetries(&backoff.ZeroBackOff{}, maxRetries)` line 158) — so the operator gets 3 total attempts before the CLI exits

## What the CLI does on success

Line 220–224:

```go
if err := utils.SaveAccessToken(decryptedAccessToken, params.Fsys); err != nil {
    return err
}
```

Writes the decrypted PAT to `~/.supabase/access-token` (the same path `supabase login --token <pat>` writes to). After that, every CLI command picks it up automatically.

---

## Implementation gotcha checklist for the api implementation

- [ ] AES-256-GCM (not AES-128 — Go uses the full 32-byte ECDH secret as the key)
- [ ] Auth tag concatenated AFTER ciphertext before hex-encoding (Go's Seal does this)
- [ ] 12-byte nonce (GCM standard, what Go uses by default)
- [ ] Public key hex is exactly 130 chars starting `04`
- [ ] Response field names: `id`, `created_at`, `access_token`, `public_key`, `nonce` (note `id`, not `session_id`)
- [ ] Single-use: Redis DEL after one 200 response
- [ ] No CORS preflight (CLI is not a browser)
- [ ] No auth header expected on the polling endpoint
- [ ] Same 404 body for all failure modes on polling endpoint (no enumeration leak)

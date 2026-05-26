# Contract — OAuth + MCP discovery metadata

## `GET /.well-known/oauth-authorization-server` (RFC 8414)

Served from the api process at `api.<apex>`.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: max-age=3600

{
  "issuer": "https://api.<apex>",
  "authorization_endpoint": "https://api.<apex>/v1/oauth/authorize",
  "token_endpoint": "https://api.<apex>/v1/oauth/token",
  "registration_endpoint": "https://api.<apex>/v1/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["platform"],
  "response_modes_supported": ["query"]
}
```

`<apex>` is the configured apex domain (e.g. `supaviser.dev`) — read at startup from the org row.

## `GET /.well-known/oauth-protected-resource` (RFC 9728)

Served from the **MCP service** at `mcp.<apex>` (NOT from api). Per RFC 9728, the discovery endpoint lives on the resource server.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: max-age=3600

{
  "resource": "https://mcp.<apex>/mcp",
  "authorization_servers": ["https://api.<apex>"],
  "scopes_supported": ["platform"],
  "bearer_methods_supported": ["header"]
}
```

This is what tells unknown MCP clients "to get a token for this resource, talk to https://api.<apex>". MCP clients then fetch the authorization server's `/.well-known/oauth-authorization-server` to find the `authorization_endpoint`, etc.

## `WWW-Authenticate` header on 401 from `/mcp`

Per RFC 6750, when the MCP server rejects a request:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="selfbase",
                  resource="https://mcp.<apex>/mcp",
                  authorization_uri="https://api.<apex>/.well-known/oauth-authorization-server"

{ "error": "invalid_token", "error_description": "Bearer token expired or revoked" }
```

This is what MCP clients use to discover the OAuth metadata on first call (before they even know about the protected-resource endpoint).

## Test obligations

- `GET /.well-known/oauth-authorization-server` against api → 200 + correct JSON shape; all URLs use `https://api.<apex>` with the real apex
- `GET /.well-known/oauth-protected-resource` against mcp → 200 + points authorization server at `api.<apex>`
- Unauthenticated `POST /mcp` → 401 + `WWW-Authenticate` header per RFC 6750
- Authorization server URL in discovery responses MUST be reachable via HTTPS (i.e., served through Caddy with the wildcard cert)
- Wire-shape: snapshot test against the JSON keys to catch accidental drift from RFC 8414 / RFC 9728

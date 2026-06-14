import { describe, expect, it } from 'vitest';
import {
  OAuthAuthorizeQuerySchema,
  OAuthTokenRequestSchema,
  OAuthRegisterRequestSchema,
} from '@supastack/shared';

/**
 * T012 — wire-shape Zod validation against each documented contract failure
 * mode.
 */

const CID = '11111111-1111-1111-1111-111111111111';

describe('OAuthAuthorizeQuerySchema', () => {
  const valid = {
    response_type: 'code',
    client_id: CID,
    redirect_uri: 'http://localhost:56831/callback',
    state: 'a'.repeat(32),
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    scope: 'platform',
  };
  it('accepts canonical request', () => {
    expect(OAuthAuthorizeQuerySchema.safeParse(valid).success).toBe(true);
  });
  it('defaults scope to "platform" when omitted', () => {
    const { scope: _ignored, ...rest } = valid;
    const parsed = OAuthAuthorizeQuerySchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.scope).toBe('platform');
  });
  it('rejects response_type != code', () => {
    expect(OAuthAuthorizeQuerySchema.safeParse({ ...valid, response_type: 'token' }).success).toBe(
      false,
    );
  });
  it('rejects code_challenge_method=plain (OAuth 2.1 hardening)', () => {
    expect(
      OAuthAuthorizeQuerySchema.safeParse({ ...valid, code_challenge_method: 'plain' }).success,
    ).toBe(false);
  });
  it('rejects non-UUID client_id', () => {
    expect(OAuthAuthorizeQuerySchema.safeParse({ ...valid, client_id: 'not-a-uuid' }).success).toBe(
      false,
    );
  });
  it('rejects code_challenge too short (<43 chars)', () => {
    expect(OAuthAuthorizeQuerySchema.safeParse({ ...valid, code_challenge: 'short' }).success).toBe(
      false,
    );
  });
  it('rejects code_challenge too long (>128 chars)', () => {
    expect(
      OAuthAuthorizeQuerySchema.safeParse({ ...valid, code_challenge: 'a'.repeat(129) }).success,
    ).toBe(false);
  });
  it('accepts resource (RFC 8707 — MCP sends it on authorize)', () => {
    expect(
      OAuthAuthorizeQuerySchema.safeParse({ ...valid, resource: 'https://mcp.example.dev/mcp' })
        .success,
    ).toBe(true);
  });
});

describe('OAuthTokenRequestSchema (discriminated union)', () => {
  const codeReq = {
    grant_type: 'authorization_code',
    code: 'auth_code_value',
    redirect_uri: 'http://localhost:56831/callback',
    client_id: CID,
    code_verifier: 'a'.repeat(43),
  };
  const refreshReq = {
    grant_type: 'refresh_token',
    refresh_token: 'rt_value',
    client_id: CID,
  };
  it('accepts authorization_code grant', () => {
    expect(OAuthTokenRequestSchema.safeParse(codeReq).success).toBe(true);
  });
  it('accepts refresh_token grant', () => {
    expect(OAuthTokenRequestSchema.safeParse(refreshReq).success).toBe(true);
  });
  it('rejects unknown grant_type', () => {
    expect(
      OAuthTokenRequestSchema.safeParse({ ...codeReq, grant_type: 'client_credentials' }).success,
    ).toBe(false);
  });
  it('rejects authorization_code missing code_verifier', () => {
    const { code_verifier: _v, ...rest } = codeReq;
    expect(OAuthTokenRequestSchema.safeParse(rest).success).toBe(false);
  });
  it('rejects code_verifier too short', () => {
    expect(OAuthTokenRequestSchema.safeParse({ ...codeReq, code_verifier: 'short' }).success).toBe(
      false,
    );
  });
  it('rejects refresh_token grant missing refresh_token', () => {
    const { refresh_token: _r, ...rest } = refreshReq;
    expect(OAuthTokenRequestSchema.safeParse(rest).success).toBe(false);
  });
  // feature 115 — RFC 8707 Resource Indicators: MCP clients send `resource` on
  // the token request. Regression for "Unrecognized key(s) in object: 'resource'".
  it('accepts authorization_code grant WITH resource (RFC 8707 — MCP)', () => {
    expect(
      OAuthTokenRequestSchema.safeParse({ ...codeReq, resource: 'https://mcp.example.dev/mcp' })
        .success,
    ).toBe(true);
  });
  it('accepts a repeated resource (array)', () => {
    expect(
      OAuthTokenRequestSchema.safeParse({
        ...codeReq,
        resource: ['https://a/mcp', 'https://b/mcp'],
      }).success,
    ).toBe(true);
  });
  it('accepts refresh_token grant WITH resource', () => {
    expect(
      OAuthTokenRequestSchema.safeParse({ ...refreshReq, resource: 'https://mcp.example.dev/mcp' })
        .success,
    ).toBe(true);
  });
  it('still rejects other unknown keys (strict preserved)', () => {
    expect(OAuthTokenRequestSchema.safeParse({ ...codeReq, bogus: 'x' }).success).toBe(false);
  });
});

describe('OAuthRegisterRequestSchema (RFC 7591)', () => {
  it('accepts minimal valid request', () => {
    expect(
      OAuthRegisterRequestSchema.safeParse({
        client_name: 'TestClient',
        redirect_uris: ['http://localhost:8765/cb'],
      }).success,
    ).toBe(true);
  });
  it('rejects empty client_name', () => {
    expect(
      OAuthRegisterRequestSchema.safeParse({
        client_name: '',
        redirect_uris: ['http://localhost/cb'],
      }).success,
    ).toBe(false);
  });
  it('rejects client_name > 200 chars', () => {
    expect(
      OAuthRegisterRequestSchema.safeParse({
        client_name: 'x'.repeat(201),
        redirect_uris: ['http://localhost/cb'],
      }).success,
    ).toBe(false);
  });
  it('rejects empty redirect_uris array', () => {
    expect(
      OAuthRegisterRequestSchema.safeParse({
        client_name: 'TestClient',
        redirect_uris: [],
      }).success,
    ).toBe(false);
  });
  it('rejects redirect_uri with javascript: scheme', () => {
    expect(
      OAuthRegisterRequestSchema.safeParse({
        client_name: 'EvilClient',
        redirect_uris: ['javascript:alert(1)'],
      }).success,
    ).toBe(false);
  });
  it('preserves extra RFC 7591 fields via passthrough', () => {
    const parsed = OAuthRegisterRequestSchema.safeParse({
      client_name: 'TestClient',
      redirect_uris: ['http://localhost/cb'],
      logo_uri: 'https://example.com/logo.png',
      tos_uri: 'https://example.com/tos',
      future_field_we_dont_know_about: 'whatever',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && (parsed.data as Record<string, unknown>).logo_uri).toBe(
      'https://example.com/logo.png',
    );
  });
});

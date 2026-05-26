import { describe, it, expect } from 'vitest';
import {
  OAuthAuthorizeQuerySchema,
  OAuthTokenAuthCodeBodySchema,
  OAuthTokenRefreshBodySchema,
  OAuthTokenRequestSchema,
  OAuthRedirectUriSchema,
  OAuthRegisterRequestSchema,
  OAuthTokenResponseSchema,
  OAuthRegisterResponseSchema,
  OAuthDiscoveryMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from '../src/oauth-schemas';

const UUID = '11111111-2222-3333-4444-555555555555';
const CHALLENGE = 'a'.repeat(43);

describe('OAuthAuthorizeQuerySchema', () => {
  const base = {
    response_type: 'code' as const,
    client_id: UUID,
    redirect_uri: 'https://app/cb',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256' as const,
  };
  it('accepts and defaults scope', () => {
    const r = OAuthAuthorizeQuerySchema.parse(base);
    expect(r.scope).toBe('platform');
  });
  it('rejects plain code_challenge_method', () => {
    expect(
      OAuthAuthorizeQuerySchema.safeParse({ ...base, code_challenge_method: 'plain' as never })
        .success,
    ).toBe(false);
  });
  it('rejects short code_challenge', () => {
    expect(OAuthAuthorizeQuerySchema.safeParse({ ...base, code_challenge: 'short' }).success).toBe(
      false,
    );
  });
  it('rejects non-uuid client_id', () => {
    expect(OAuthAuthorizeQuerySchema.safeParse({ ...base, client_id: 'nope' }).success).toBe(false);
  });
  it('strict — unknown rejected', () => {
    expect(OAuthAuthorizeQuerySchema.safeParse({ ...base, extra: 1 } as never).success).toBe(false);
  });
});

describe('OAuthToken request bodies', () => {
  const code = {
    grant_type: 'authorization_code' as const,
    code: 'c',
    redirect_uri: 'https://app/cb',
    client_id: UUID,
    code_verifier: 'v'.repeat(43),
  };
  const refresh = {
    grant_type: 'refresh_token' as const,
    refresh_token: 'r',
    client_id: UUID,
  };
  it('auth code body', () => {
    expect(OAuthTokenAuthCodeBodySchema.parse(code)).toBeDefined();
    expect(
      OAuthTokenAuthCodeBodySchema.safeParse({ ...code, code_verifier: 'short' }).success,
    ).toBe(false);
  });
  it('refresh body', () => {
    expect(OAuthTokenRefreshBodySchema.parse(refresh)).toBeDefined();
  });
  it('discriminated union', () => {
    expect(OAuthTokenRequestSchema.parse(code)).toBeDefined();
    expect(OAuthTokenRequestSchema.parse(refresh)).toBeDefined();
    expect(OAuthTokenRequestSchema.safeParse({ grant_type: 'bogus' } as never).success).toBe(false);
  });
});

describe('register schemas', () => {
  it('OAuthRedirectUriSchema accepts http(s), rejects others', () => {
    expect(OAuthRedirectUriSchema.parse('https://x')).toBeDefined();
    expect(OAuthRedirectUriSchema.parse('http://x')).toBeDefined();
    expect(OAuthRedirectUriSchema.safeParse('ftp://x').success).toBe(false);
    expect(OAuthRedirectUriSchema.safeParse('x'.repeat(2050)).success).toBe(false);
  });
  it('OAuthRegisterRequestSchema passthrough + redirect_uris min 1', () => {
    expect(
      OAuthRegisterRequestSchema.parse({
        client_name: 'n',
        redirect_uris: ['https://x'],
        extra: 'kept',
      }),
    ).toBeDefined();
    expect(
      OAuthRegisterRequestSchema.safeParse({ client_name: 'n', redirect_uris: [] }).success,
    ).toBe(false);
  });
  it('OAuthRegisterResponseSchema', () => {
    expect(
      OAuthRegisterResponseSchema.parse({
        client_id: UUID,
        client_name: 'n',
        redirect_uris: ['https://x'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        client_id_issued_at: 0,
      }),
    ).toBeDefined();
  });
});

describe('token response + discovery metadata', () => {
  it('OAuthTokenResponseSchema strict', () => {
    expect(
      OAuthTokenResponseSchema.parse({
        access_token: 'a',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'r',
        scope: 'platform',
      }),
    ).toBeDefined();
    expect(
      OAuthTokenResponseSchema.safeParse({
        access_token: 'a',
        token_type: 'Bearer',
        expires_in: 0,
        refresh_token: 'r',
        scope: '',
      }).success,
    ).toBe(false);
  });
  it('OAuthDiscoveryMetadataSchema', () => {
    expect(
      OAuthDiscoveryMetadataSchema.parse({
        issuer: 'https://i',
        authorization_endpoint: 'https://a',
        token_endpoint: 'https://t',
        registration_endpoint: 'https://r',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['platform'],
        response_modes_supported: ['query'],
      }),
    ).toBeDefined();
  });
  it('OAuthProtectedResourceMetadataSchema', () => {
    expect(
      OAuthProtectedResourceMetadataSchema.parse({
        resource: 'https://r',
        authorization_servers: ['https://a'],
        scopes_supported: ['platform'],
        bearer_methods_supported: ['header'],
      }),
    ).toBeDefined();
  });
});

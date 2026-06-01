// Paste this in the browser console when Studio is open to inject a mock session.
// Run before navigating to any project page.
(function injectSession() {
  const now = Math.floor(Date.now() / 1000), exp = now + 7200
  function b64(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }
  const jwt = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
    b64(JSON.stringify({
      aud: 'authenticated', exp, iat: now,
      iss: 'http://148.113.1.164:4000/',
      sub: '00000000-0000-0000-0000-000000000001',
      email: 'admin@localhost', role: 'authenticated', aal: 'aal1',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}, amr: [{ method: 'password', timestamp: now }],
      session_id: 's1'
    })) + '.fakesig'

  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('supabase.dashboard.auth.token', JSON.stringify({
    access_token: jwt, token_type: 'bearer',
    expires_in: 7200, expires_at: exp,
    refresh_token: 'mock-' + now,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated', role: 'authenticated',
      email: 'admin@localhost',
      email_confirmed_at: '2024-01-01T00:00:00Z',
      confirmed_at: '2024-01-01T00:00:00Z',
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}, identities: [],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: new Date().toISOString()
    }
  }))
  console.log('[mock] Session injected, valid 2h. Navigate to your page.')
})()

import { describe, expect, it } from 'vitest'
import { authCode, authRedirect, issuedSession, nativeAuth, storedSession } from '../src/auth-protocol'

let session = () => ({ owner: 'google-owner', accessToken: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString(), refreshToken: 'b'.repeat(64), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })
let config = { protocol: 1, clientId: 'bmux-remote', authorizationEndpoint: '/api/auth/authorize', tokenEndpoint: '/api/auth/token', revocationEndpoint: '/api/auth/revoke' }
describe('hosted native auth', () => {
  it('accepts only the same-origin advertised account endpoints', () => {
    expect(nativeAuth(config, 'https://remote.bmux.cc').tokenEndpoint).toBe('https://remote.bmux.cc/api/auth/token')
    for (let authorizationEndpoint of ['https://other.example/api/auth', 'http://remote.bmux.cc/api/auth', '/api/auth?token=secret', '/connect']) expect(() => nativeAuth({ ...config, authorizationEndpoint }, 'https://remote.bmux.cc')).toThrow()
    expect(() => nativeAuth(undefined, 'https://remote.bmux.cc')).toThrow('Mobile sign-in is unavailable')
  })
  it('binds the returned code to the exact callback and original state', () => {
    let code = 'c'.repeat(64)
    expect(authCode(authRedirect + '?state=expected&code=' + code, 'expected')).toBe(code)
    for (let url of [
      'other://auth/callback?state=expected&code=' + code,
      'bmux-remote://other/callback?state=expected&code=' + code,
      authRedirect + '?state=wrong&code=' + code,
      authRedirect + '?state=expected&state=other&code=' + code,
      authRedirect + '?state=expected&code=' + code + '&code=duplicate',
      authRedirect + '?state=expected&code=' + code + '&error=denied',
      authRedirect + '#state=expected&code=' + code,
    ]) expect(() => authCode(url, 'expected')).toThrow()
  })
  it('retains expired access tokens only with a live refresh credential', () => {
    let value = session()
    value.expiresAt = new Date(Date.now() - 1000).toISOString()
    expect(storedSession(value)).toEqual(value)
    expect(storedSession({ ...value, refreshToken: undefined })).toBeUndefined()
    expect(storedSession({ ...value, refreshExpiresAt: 'invalid' })).toBeUndefined()
  })
  it('rejects owner changes and incomplete refresh rotations', () => {
    expect(issuedSession(session(), 'google-owner').owner).toBe('google-owner')
    expect(() => issuedSession(session(), 'different-owner')).toThrow()
    expect(() => issuedSession({ ...session(), refreshToken: undefined })).toThrow()
  })
})

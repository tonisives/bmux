import { describe, expect, it } from 'vitest'
import { authCode, authRedirect, issuedSession, mobileAuthEndpoints, storedSession } from '../src/auth-protocol'

let session = () => ({ owner: 'google-owner', accessToken: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString(), refreshToken: 'b'.repeat(64), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })
describe('hosted native auth', () => {
  it('uses the canonical HTTPS mobile account endpoints', () => {
    expect(mobileAuthEndpoints('https://remote.bmux.cc').exchange).toBe('https://remote.bmux.cc/api/auth/mobile/exchange')
    expect(() => mobileAuthEndpoints('http://remote.bmux.cc')).toThrow()
    expect(() => mobileAuthEndpoints('https://user:password@remote.bmux.cc')).toThrow()
    expect(mobileAuthEndpoints('http://127.0.0.1:1943').refresh).toBe('http://127.0.0.1:1943/api/auth/mobile/refresh')
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

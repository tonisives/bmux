import { describe, expect, it, vi } from 'vitest'
import { googleAccessIdentity } from '../remote/google-auth'

let token = { aud: 'client', azp: 'client', sub: 'google-subject', email_verified: 'true', expires_in: '3599', scope: 'openid https://www.googleapis.com/auth/userinfo.email' }
let user = { sub: 'google-subject', email: 'viewer@example.test', email_verified: true, name: 'Viewer' }
let requestFor = (info: object, profile = user) => vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(info)).mockResolvedValueOnce(Response.json(profile))

describe('Google access token login', () => {
  it('accepts the tokeninfo endpoint OpenID claims and verifies userinfo', async () => {
    let request = requestFor(token)
    await expect(googleAccessIdentity('fixture-token', 'client', request)).resolves.toEqual({ owner: user.sub, email: user.email, name: user.name })
    expect(request.mock.calls[0][1]?.method).toBe('POST')
    expect(request.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer fixture-token' })
  })
  it.each([{ aud: 'other' }, { azp: 'other' }, { sub: undefined }, { email_verified: 'false' }, { expires_in: '0' }, { expires_in: 'NaN' }, { scope: 'openid' }])('rejects invalid token claims %j before userinfo', async changes => {
    let request = requestFor({ ...token, ...changes })
    await expect(googleAccessIdentity('fixture-token', 'client', request)).rejects.toThrow('Invalid login')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([{ sub: 'another-subject' }, { email_verified: false }, { email: '' }])('rejects inconsistent userinfo %j', async changes => {
    await expect(googleAccessIdentity('fixture-token', 'client', requestFor(token, { ...user, ...changes }))).rejects.toThrow('Invalid login')
  })
  it('rejects upstream token failure', async () => {
    await expect(googleAccessIdentity('fixture-token', 'client', vi.fn().mockResolvedValue(new Response('', { status: 400 })))).rejects.toThrow('Invalid login')
  })
})

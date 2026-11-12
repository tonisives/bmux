type TokenInfo = { aud?: string; azp?: string; sub?: string; email_verified?: boolean | string; expires_in?: number | string; scope?: string }
type UserInfo = { sub?: string; email?: string; email_verified?: boolean; name?: string }

export let googleAccessIdentity = async (accessToken: string, audience: string, request: typeof fetch = fetch) => {
  let verified = await request('https://oauth2.googleapis.com/tokeninfo', { method: 'POST', body: new URLSearchParams({ access_token: accessToken }), signal: AbortSignal.timeout(10000) })
  if (!verified.ok) throw new Error('Invalid login')
  let info = await verified.json() as TokenInfo, scopes = info.scope?.split(' ') ?? []
  if (info.aud !== audience || info.azp !== audience || !info.sub || ![true, 'true'].includes(info.email_verified ?? false) || !Number.isFinite(Number(info.expires_in)) || Number(info.expires_in) <= 0 || !scopes.some(scope => ['email', 'https://www.googleapis.com/auth/userinfo.email'].includes(scope))) throw new Error('Invalid login')
  let response = await request('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('Invalid login')
  let user = await response.json() as UserInfo
  if (user.sub !== info.sub || user.email_verified !== true || typeof user.email !== 'string' || !user.email) throw new Error('Invalid login')
  return { owner: user.sub, email: user.email, name: user.name ?? '' }
}

export type RemoteNativeCredentials = { owner: string; accessToken: string; expiresAt: string; refreshToken: string; refreshExpiresAt: string }
export type RemoteNativeExchange = { code: string; codeVerifier: string }
export type RemoteNativeRefresh = { refreshToken: string }

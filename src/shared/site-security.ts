export type ConnectionStatus = 'loading' | 'unknown' | 'secure' | 'http' | 'certificate-error' | 'mixed' | 'insecure' | 'local'
export type SiteCertificate = { subject: string; issuer: string; validFrom: number; validTo: number; protocol?: string }
export type SiteSecurity = { url: string; status: ConnectionStatus; certificate?: SiteCertificate; error?: string }
export let connectionLabels: Record<ConnectionStatus, string> = {
  loading: 'Checking connection', unknown: 'Connection status unavailable', secure: 'Connection is secure',
  http: 'Connection is not encrypted', 'certificate-error': 'Certificate error', mixed: 'Mixed content',
  insecure: 'Connection is not secure', local: 'Local or internal page',
}
export let initialSecurity = (url: string, loading = false): SiteSecurity => ({ url, status: loading ? 'loading' : /^(about:|file:|chrome:|chrome-extension:)/i.test(url) ? 'local' : /^http:/i.test(url) ? 'http' : 'unknown' })

export type ChromiumSecurity = {
  securityState: string
  securityStateIssueIds: string[]
  certificateSecurityState?: { subjectName: string; issuer: string; validFrom: number; validTo: number; protocol: string; certificateNetworkError?: string }
}
export let chromiumSecurity = (url: string, state: ChromiumSecurity): SiteSecurity => {
  let base = initialSecurity(url)
  if (base.status === 'local' || base.status === 'http') return base
  let cert = state.certificateSecurityState
  let certificate = cert ? { subject: cert.subjectName, issuer: cert.issuer, validFrom: cert.validFrom, validTo: cert.validTo, protocol: cert.protocol } : undefined
  let issues = state.securityStateIssueIds ?? []
  let error = cert?.certificateNetworkError
  let mixed = issues.some(issue => /mixed|insecure-content|insecure-form/i.test(issue))
  let status: ConnectionStatus = error ? 'certificate-error' : mixed ? 'mixed' : state.securityState === 'secure' && cert && /^https:/i.test(url) ? 'secure' : ['insecure', 'insecure-broken', 'neutral', 'info'].includes(state.securityState) ? 'insecure' : 'unknown'
  return { url, status, certificate, ...(error ? { error } : {}) }
}

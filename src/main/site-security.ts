import type { WebContents } from 'electron'
import { chromiumSecurity, initialSecurity } from '../shared/site-security'
import type { SiteSecurity, ChromiumSecurity } from '../shared/site-security'

type Response = { url: string; securityState: string; securityDetails?: NonNullable<ChromiumSecurity['certificateSecurityState']> }
export let trackSiteSecurity = (contents: WebContents, changed: (state: SiteSecurity) => void) => {
  let current = initialSecurity(contents.getURL() || 'about:blank')
  let mainFrame = '', loader = '', pendingLoader = '', mixed = false, closed = false
  let frameSessions = new Set<string>()
  let retiredLoaders = new Set<string>()
  let document: { loader: string; response: Response } | undefined
  let publish = (state: SiteSecurity) => { current = state; if (!closed) changed(state) }
  let reset = (url: string) => {
    for (let id of [loader, pendingLoader]) if (id) retiredLoaders.add(id)
    if (retiredLoaders.size > 32) retiredLoaders.delete(retiredLoaders.values().next().value!)
    frameSessions.clear()
    loader = ''; pendingLoader = ''; document = undefined; mixed = false; publish(initialSecurity(url, true))
  }
  let apply = () => {
    if (!document || document.loader !== loader || document.response.url !== current.url || current.status === 'certificate-error') return
    publish(chromiumSecurity(current.url, { securityState: document.response.securityState, certificateSecurityState: document.response.securityDetails, securityStateIssueIds: mixed ? ['mixed-content'] : [] }))
  }
  let message = (_event: Electron.Event, method: string, params: any, sessionId?: string) => {
    if (closed) return
    if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
      let id = params.sessionId
      frameSessions.add(id)
      // Audits replays existing issues, including mixed requests made before an
      // out-of-process frame was attached by the page tools.
      void contents.debugger.sendCommand('Audits.enable', {}, id).catch(() => undefined)
      void contents.debugger.sendCommand('Network.enable', {}, id).catch(() => undefined)
    }
    if (method === 'Target.detachedFromTarget') frameSessions.delete(params.sessionId)
    if (sessionId && !frameSessions.has(sessionId)) return
    if (method === 'Audits.issueAdded' && params.issue.code === 'MixedContentIssue' && /^https:/i.test(current.url)) { mixed = true; apply() }
    if (method === 'Network.requestWillBeSent' && params.request.mixedContentType && params.request.mixedContentType !== 'none' && /^https:/i.test(current.url)) { mixed = true; apply() }
    if (sessionId) return
    if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      if (retiredLoaders.has(params.frame.loaderId) || (pendingLoader && pendingLoader !== params.frame.loaderId)) return
      mainFrame = params.frame.id
      loader = params.frame.loaderId
      if (current.status === 'certificate-error') return
      publish(initialSecurity(params.frame.url))
      apply()
    }
    if (method === 'Network.requestWillBeSent') {
      if (params.type === 'Document' && params.frameId === mainFrame && params.request.url === current.url && !retiredLoaders.has(params.loaderId)) pendingLoader = params.loaderId
    }
    if (method === 'Network.responseReceived' && params.type === 'Document' && params.frameId === mainFrame && params.response.url === current.url && (params.loaderId === pendingLoader || params.loaderId === loader)) {
      let { url, securityState, securityDetails } = params.response
      document = { loader: params.loaderId, response: { url, securityState, securityDetails } }
      apply()
    }
  }
  contents.debugger.on('message', message)
  contents.debugger.on('detach', () => { loader = ''; document = undefined; if (!closed) publish(initialSecurity(current.url)) })
  contents.on('did-start-navigation', (_event, url, inPlace, main) => { if (main && !inPlace) reset(url) })
  contents.on('did-redirect-navigation', (_event, url, inPlace, main) => { if (main && !inPlace) publish(initialSecurity(url, true)) })
  contents.on('did-navigate-in-page', (_event, url, main) => { if (main) { if (document) document.response = { ...document.response, url }; publish({ ...current, url }) } })
  contents.on('certificate-error', (_event, url, error, certificate, _callback, main) => {
    if (!main || closed || url !== current.url) return
    document = undefined
    publish({ url, status: 'certificate-error', error, certificate: { subject: certificate.subjectName, issuer: certificate.issuerName, validFrom: certificate.validStart, validTo: certificate.validExpiry } })
    // Observe the failure without overriding Electron's default rejection.
  })
  contents.on('did-fail-load', (_event, code, description, url, main) => {
    if (!main || code === -3 || current.url !== url || current.status === 'certificate-error') return
    document = undefined
    publish({ url, status: /CERT_|SSL_/.test(description) ? 'certificate-error' : 'unknown', error: description })
  })
  contents.on('did-stop-loading', () => { if (current.status === 'loading') publish(initialSecurity(contents.getURL() || current.url)) })
  contents.on('render-process-gone', () => { document = undefined; publish({ url: current.url, status: 'unknown' }) })
  contents.once('destroyed', () => { closed = true })
  publish(current)
  return async () => {
    if (closed || contents.isDestroyed()) return
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
      await contents.debugger.sendCommand('Page.enable')
      let { frameTree } = await contents.debugger.sendCommand('Page.getFrameTree')
      mainFrame = frameTree.frame.id
      await contents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 })
      await contents.debugger.sendCommand('Audits.enable').catch(() => undefined)
    } catch { publish(initialSecurity(current.url)) }
  }
}

// Loaded only with the disposable, checksum-pinned Bitwarden bundle in CI.
let runSuggestionProbe = async () => {
  let dependencies = ['logService', 'cipherService', 'autofillService', 'authService', 'environmentService', 'domainSettingsService', 'autofillSettingsService', 'i18nService', 'platformUtilsService', 'vaultSettingsService', 'fido2ActiveRequestManager', 'inlineMenuFieldQualificationService', 'themeStateService', 'totpService', 'accountService', 'generatorHistoryService', 'generatorService']
  // Logged-out Bitwarden does not create its overlay. Instantiate the official
  // class directly, without bootstrapping an account or logging into a vault.
  let services = dependencies.map(() => ({}))
  services[5] = { resolvedEnableFillAssist$: { pipe: () => ({ subscribe: () => undefined }) } }
  let original = new self.bmuxProbeOverlay(...services)
  let currentTab = { id: 101, windowId: 1, url: 'http://127.0.0.1/first' }
  let query = chrome.tabs.query
  chrome.tabs.query = (_properties, callback) => callback([currentTab])
  let waitFor = async predicate => {
    let deadline = Date.now() + 5000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Suggestion probe did not reach its expected state')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  let create = () => {
    // A fresh real OverlayBackground instance also creates the real RxJS
    // subscriptions. Only its external dependencies and output are fixtures.
    let overlay = new original.constructor(...dependencies.map(key => original[key]))
    overlay.authService = { activeAccountStatus$: new original.credential$.constructor(2) }
    overlay.fido2ActiveRequestManager = { getActiveRequest: () => null }
    overlay.availablePasskeyAuthCredentials$ = () => new original.updateOverlayCiphers$.constructor()
    overlay.shouldShowInlineMenuAccountCreation = () => false
    overlay.checkFocusedFieldHasValue = async () => false
    return overlay
  }
  let expectedErrors = []
  let onError = event => {
    if (!event.message.includes('bmux fixture lookup failed')) return
    expectedErrors.push(event.message)
    event.preventDefault()
  }
  self.addEventListener('error', onError)
  try {
    let overlay = create(), calls = 0, publications = []
    overlay.getCipherViews = async () => { calls++; return [{ id: 'fixture-login' }] }
    overlay.updateInlineMenuListCiphers = async () => publications.push([...overlay.inlineMenuCiphers.values()].map(item => item.id))
    await overlay.updateOverlayCiphers()
    await waitFor(() => publications.length === 1)
    let healthy = { subscribed: overlay.updateOverlayCiphers$.observed, items: publications[0] }
    overlay.getCipherViews = async () => { calls++; throw new Error('bmux fixture lookup failed') }
    await overlay.updateOverlayCiphers()
    await waitFor(() => !overlay.updateOverlayCiphers$.observed && expectedErrors.length === 1)
    let callsAfterFailure = calls
    overlay.getCipherViews = async () => { calls++; return [{ id: 'fixture-recovered' }] }
    for (let index = 0; index < 3; index++) await overlay.updateOverlayCiphers()
    let afterFailure = {
      subscribed: overlay.updateOverlayCiphers$.observed,
      callsAfterFailure, callsAfterMoreUpdates: calls,
      cachedItems: overlay.inlineMenuCiphers.size, publications: publications.length,
    }
    let restarted = create(), restartedPublications = []
    restarted.getCipherViews = async () => [{ id: 'fixture-recovered' }]
    restarted.updateInlineMenuListCiphers = async () => restartedPublications.push([...restarted.inlineMenuCiphers.values()].map(item => item.id))
    await restarted.updateOverlayCiphers()
    await waitFor(() => restartedPublications.length === 1)

    // Keep the original handler and updateInlineMenuListCiphers. Hold only
    // its async item-building dependency, then switch tabs and finish newer
    // work first. switchMap cannot cancel side effects inside the old promise.
    let racing = create(), builds = [], sent = []
    racing.getCipherViews = async tab => tab.id === 101 ? [] : [{ id: 'fixture-current' }]
    racing.getInlineMenuCipherData = () => new Promise(resolve => {
      builds.push({ items: [...racing.inlineMenuCiphers.values()].map(item => item.id), resolve })
    })
    racing.postMessageToPort = (_port, message) => sent.push(message.ciphers)
    await racing.updateOverlayCiphers()
    await waitFor(() => builds.length === 1)
    currentTab = { id: 102, windowId: 1, url: 'http://127.0.0.1/second' }
    await racing.updateOverlayCiphers()
    await waitFor(() => builds.length === 2)
    builds[1].resolve(builds[1].items)
    await waitFor(() => sent.length === 1)
    builds[0].resolve(builds[0].items)
    await waitFor(() => sent.length === 2)
    return { healthy, afterFailure, reinitialized: restartedPublications[0], race: { builds: builds.map(build => build.items), sent, subscribed: racing.updateOverlayCiphers$.observed } }
  } finally {
    chrome.tabs.query = query
    self.removeEventListener('error', onError)
  }
}
self.bmuxSuggestionProbe = runSuggestionProbe().then(result => ({ result }), error => ({ error: String(error.stack || error) }))

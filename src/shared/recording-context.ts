// Plugin IDs and scraper context labels address the same recordings tab.
export let recordingContext = (value?: string) => (value ?? '').trim().toLowerCase().replace(/^bmux\./, '')

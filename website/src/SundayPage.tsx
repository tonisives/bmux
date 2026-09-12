import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import css from './SundayPage.module.css'

export let SundayPage = () => <SundayProvider><Page /></SundayProvider>

let GITHUB = 'https://github.com/tonisives/bmux'
let FEATURES = [
  { id: 'split-panes', label: 'Split panes', description: 'Open Chromium pages side by side, resize the panes and save the layout for later', shortcut: 'Ctrl B, then %' },
  { id: 'switch-sessions', label: 'Switch sessions', description: 'Keep a separate workspace for each project and switch between them from the session picker', shortcut: 'Ctrl B, then S' },
  { id: 'run-agent', label: 'Run an agent', description: 'Let an agent navigate, type and click in a bot profile while you continue using another pane', shortcut: 'bmux type / bmux click' },
] as const
type Feature = typeof FEATURES[number]
type SundayContextValue = { feature: Feature; setFeature: (feature: Feature) => void }
let SundayContext = createContext<SundayContextValue | null>(null)
let useSunday = () => useContext(SundayContext)!

let SundayProvider = ({ children }: { children: ReactNode }) => {
  let [feature, setFeature] = useState<Feature>(FEATURES[0])
  return <SundayContext.Provider value={{ feature, setFeature }}>{children}</SundayContext.Provider>
}

let Lantern = () => <img className={css.lantern} src="/cdn/icon-512.png" alt="bmux lantern" width="512" height="512" />

let Page = () => <div className={css.page} id="top">
  <a className={css.skipLink} href="#content">Skip to content</a>
  <div className={css.container}>
    <Header />
    <main id="content"><Hero /><FeatureShowcase /><Sessions /><Agents /><BrowserTools /><Install /></main>
    <Footer />
  </div>
</div>

let Header = () => <header className={css.header}>
  <a className={css.brand} href="#top">bmux</a>
  <nav aria-label="Main navigation"><a href="#features">Features</a><a href="#agents">For agents</a><a href={GITHUB}>GitHub</a></nav>
</header>

let Hero = () => <section className={css.hero}>
  <Lantern />
  <h1>Browser with split panes, sessions and agent control</h1>
  <p>A macOS browser built on Chromium, with separate profiles and a CLI for browser automation</p>
  <div className={css.heroActions}><a className={css.primaryButton} href="#install">Get bmux</a><a className={css.secondaryButton} href={GITHUB}>View source</a></div>
  <span className={css.heroNote}>Free and open source</span>
</section>

let FeatureButton = ({ feature }: { feature: Feature }) => {
  let { feature: selectedFeature, setFeature } = useSunday()
  let selectFeature = () => setFeature(feature)
  return <button type="button" onClick={selectFeature} aria-pressed={selectedFeature.id === feature.id} aria-controls="app-capture" className={css.featureButton}>{feature.label}</button>
}

let FeatureShowcase = () => {
  let { feature } = useSunday()
  return <section className={css.showcase} id="features" aria-label="App features">
    <div className={css.featureControls} role="group" aria-label="Choose a feature">{FEATURES.map(item => <FeatureButton key={item.id} feature={item} />)}</div>
    <figure className={css.capture} id="app-capture">
      <a href={`/cdn/product/${feature.id}.png`} target="_blank" rel="noreferrer" aria-label={`Open full-size app screenshot: ${feature.label}`}><img src={`/cdn/product/${feature.id}.png`} alt={`bmux app showing ${feature.label.toLowerCase()} with local sample pages`} width="1360" height="663" /></a>
      <figcaption><span>Real app screenshot</span><a href={`/cdn/product/${feature.id}.png`} target="_blank" rel="noreferrer">View full size</a></figcaption>
    </figure>
    <div className={css.featureDescription} aria-live="polite" aria-atomic="true"><p>{feature.description}</p><code>{feature.shortcut}</code></div>
  </section>
}

let Sessions = () => <section className={css.sessions} aria-labelledby="sessions-title">
  <div className={css.sectionCopy}>
    <h2 id="sessions-title">Sessions and saved layouts</h2>
    <p>Use separate sessions for development, research and personal browsing, each with its own windows and pane layout</p>
    <p>Detach a window and reconnect to the same live pages while bmux is running, or save a layout to restore the arrangement after a restart</p>
    <p className={css.note}>Quitting bmux stops the browser and reloads pages on the next launch</p>
  </div>
  <DetailCapture id="switch-sessions" alt="The bmux session picker with development, research and personal sessions" caption="Switch between workspaces from the session picker" />
</section>

let DetailCapture = ({ id, alt, caption }: { id: Feature['id']; alt: string; caption: string }) => <figure className={css.detailCapture}>
  <a href={`/cdn/product/${id}.png`} target="_blank" rel="noreferrer" aria-label={`Open full-size app screenshot: ${caption}`}><img src={`/cdn/product/${id}.png`} alt={alt} width="1360" height="663" loading="lazy" /></a>
  <figcaption>{caption}</figcaption>
</figure>

let Agents = () => <section className={css.agents} id="agents" aria-labelledby="agents-title">
  <div className={css.sectionCopy}>
    <h2 id="agents-title">Made for agents</h2>
    <p>Agents can navigate pages, inspect the DOM, run JavaScript, click, type and take screenshots through the bmux CLI, with JSON output and explicit tab IDs, separate profiles for their logins, and background commands that keep your selected pane and keyboard focus in place</p>
    <a className={css.textLink} href={`${GITHUB}/blob/main/AGENT.md`}>Read the agent guide</a>
  </div>
  <DetailCapture id="run-agent" alt="A task added to the release checklist through the bmux CLI in a separate bot profile" caption="A task entered by the CLI in the bot pane" />
</section>

let BrowserTools = () => <section className={css.browserTools} aria-labelledby="tools-title">
  <h2 id="tools-title">Profiles, shortcuts and browser tools</h2>
  <div className={css.toolsGrid}>
    <article><h3>Separate profiles</h3><p>Keep work, personal and bot logins apart, with separate cookies, storage and permissions for each profile</p></article>
    <article><h3>Keyboard control</h3><p>Split panes, switch sessions and open URLs from the keyboard, with shortcuts you can edit in a configuration file</p></article>
    <article><h3>Browser tools</h3><p>Use ad blocking, Dark Reader, Bitwarden filling and local userscripts, or add your own actions with script plugins</p></article>
  </div>
</section>

let Install = () => <section className={css.install} id="install" aria-labelledby="install-title">
  <div className={css.sectionCopy}><h2 id="install-title">Install on macOS</h2><p>bmux is an early preview, currently built from source with unsigned local builds</p><p>Build with Node 24, pnpm 11 and Xcode Command Line Tools</p><a className={css.textLink} href={`${GITHUB}#get-started`}>Full setup instructions</a></div>
  <InstallCommands />
</section>

let InstallCommands = () => {
  let [copyStatus, setCopyStatus] = useState('')
  let commands = 'git clone https://github.com/tonisives/bmux.git\ncd bmux\npnpm install\npnpm package'
  let copyCommands = async () => {
    try { await navigator.clipboard.writeText(commands); setCopyStatus('Commands copied') }
    catch { setCopyStatus('Select the commands to copy them') }
  }
  return <div className={css.installCommands}>
    <div className={css.commandsHeader}><span>Build and install</span><button type="button" onClick={copyCommands}>Copy commands</button></div>
    <pre tabIndex={0} aria-label="Installation commands"><code>{commands}</code></pre>
    <p>Installs bmux into <code>~/workspace/_tools</code></p>
    <span className={css.copyStatus} role="status">{copyStatus}</span>
  </div>
}

let Footer = () => <footer className={css.footer}><span>bmux</span><nav aria-label="Footer navigation"><a href={GITHUB}>GitHub</a><a href={`${GITHUB}/blob/main/LICENSE`}>MIT license</a><a href="https://tonis.dev">Made by Tõnis</a></nav></footer>

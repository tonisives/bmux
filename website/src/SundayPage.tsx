import { useState } from 'react'
import css from './SundayPage.module.css'
import { KeyboardShortcuts } from './KeyboardShortcuts'

export let SundayPage = () => <div className={css.page} id="top">
  <a className={css.skipLink} href="#content">Skip to content</a>
  <div className={css.container}>
    <header className={css.header}>
      <a className={css.brand} href="#top">bmux</a>
      <nav aria-label="Main navigation"><a href="#features">Features</a><a href="#install">Install</a><a href={GITHUB}>GitHub</a></nav>
    </header>
    <main id="content"><Hero /><Features /><BrowserTools /><Integrations /><ComingSoon /><Install /></main>
    <footer className={css.footer}><span>bmux</span><nav aria-label="Footer navigation"><a href={GITHUB}>GitHub</a><a href="/docs/license/">MIT license</a><a href="https://tonis.dev">Made by Tõnis</a></nav></footer>
  </div>
</div>

let GITHUB = 'https://github.com/tonisives/bmux'

let Hero = () => <section className={css.hero}>
  <img className={css.lantern} src="https://cdn.digthree.tonis.dev/bmux/website-82388779203b/icon-512.png" alt="bmux lantern" width="512" height="512" />
  <h1>Browser with split panes, sessions and agent control</h1>
  <p>Free and open source</p>
  <div className={css.heroActions}><a className={css.primaryButton} href="#install">Get bmux</a><a className={css.secondaryButton} href={GITHUB}>View source</a></div>
</section>

let Features = () => <div id="features"><SplitPanes /><Sessions /><Agents /></div>

let SplitPanes = () => <section className={css.feature} id="split-panes" aria-labelledby="split-title">
  <div className={css.featureHeading}><div><h2 id="split-title"><FeatureIcon name="split-panes" />Split panes</h2><p>Open pages side by side and save your layout</p></div><KeyboardShortcuts /></div>
  <Capture id="split-panes" alt="Two Chromium pages side by side in bmux, each with its own address bar" />
</section>

let Sessions = () => <section className={css.feature} id="switch-sessions" aria-labelledby="sessions-title">
  <div className={css.featureHeading}><div><h2 id="sessions-title"><FeatureIcon name="sessions" />Switch sessions</h2><p>Keep a workspace for each project</p></div><a className={css.secondaryButton} href="/docs/readme/#model">About sessions</a></div>
  <Capture id="switch-sessions" alt="The bmux session picker showing development, research and personal workspaces" />
</section>

let Agents = () => <section className={`${css.feature} ${css.agents}`} id="agents" aria-labelledby="agents-title">
  <div className={css.featureHeading}><div><h2 id="agents-title"><FeatureIcon name="agent" />Run an agent</h2><p>Made for agents that browse, click, type and take screenshots through the CLI, with separate logins and background commands that keep your focus in place</p></div><a className={css.secondaryButton} href="/docs/agent/">Agent guide</a></div>
  <Capture id="run-agent" alt="A task added through the bmux CLI in the bot pane while the human pane stays selected" />
</section>

let Capture = ({ id, alt }: { id: string; alt: string }) => <figure className={css.capture}>
  <img src={`https://cdn.digthree.tonis.dev/bmux/website-82388779203b/product/${id}.png`} alt={alt} width="1120" height="663" loading={id === 'split-panes' ? 'eager' : 'lazy'} />
</figure>

let FeatureIcon = ({ name }: { name: 'split-panes' | 'sessions' | 'agent' | 'profiles' | 'keyboard' | 'tools' }) => <img className={css.featureIcon} src={`https://cdn.digthree.tonis.dev/bmux/website-82388779203b/feature-icons/${name}.svg`} alt="" width="44" height="44" />

let BrowserTools = () => <section className={css.toolsGrid} aria-label="More features">
  <article><h2><FeatureIcon name="profiles" />Separate profiles</h2><p>Work, personal and bot logins</p></article>
  <article><h2><FeatureIcon name="keyboard" />Keyboard control</h2><p>Shortcuts you can customize</p></article>
  <article><h2><FeatureIcon name="tools" />Browser tools</h2><p>Ad blocking, dark mode and Bitwarden</p></article>
</section>

let integrations = [
  { title: 'Ad blocking', status: 'Built in', description: 'Block ads and trackers', href: '/docs/browser-tools/#ad-and-tracker-blocking', icon: 'tools' },
  { title: 'Dark Reader', status: 'Built in', description: 'Dark mode for websites', href: '/docs/browser-tools/#website-dark-mode', icon: 'tools' },
  { title: 'Saved forms', status: 'Included', description: 'Save and fill non-password fields', href: '/docs/browser-tools/#saved-forms', icon: 'profiles' },
  { title: 'Bitwarden CLI', status: 'Optional setup', description: 'Unlock your vault and fill logins', href: '/docs/browser-tools/#bitwarden', icon: 'profiles' },
  { title: 'Scripts and plugins', status: 'Available', description: 'Page styles, scripts and local actions', href: '/docs/plugins/', icon: 'agent' },
  { title: 'Bitwarden desktop', status: 'Experimental', description: 'Pair with the desktop app', href: '/docs/examples/plugins/experimental.bitwarden/', icon: 'tools' },
] as const

let Integrations = () => <section className={css.integrations} id="integrations" aria-labelledby="integrations-title">
  <h2 id="integrations-title">Plugins and browser tools</h2>
  <div className={css.integrationGrid}>{integrations.map(item => <Integration key={item.title} item={item} />)}</div>
  <p className={css.extensionNote}>Chrome extensions are not supported <a href="/docs/readme/#current-boundaries">Current limits</a></p>
  <a className={css.textLink} href="/docs/todo/">Development status</a>
</section>

let Integration = ({ item }: { item: typeof integrations[number] }) => <article className={css.integration}>
  <FeatureIcon name={item.icon} />
  <span className={css.badge}>{item.status}</span>
  <h3>{item.title}</h3><p>{item.description}</p><a className={css.textLink} href={item.href}>Read more<span className={css.srOnly}> about {item.title}</span></a>
</article>

let ComingSoon = () => <section className={css.comingSoon} id="coming-soon" aria-labelledby="coming-soon-title">
  <span className={css.badge}>Coming soon</span>
  <h2 id="coming-soon-title">Browser automation across your servers</h2>
  <p className={css.comingSoonIntro}>A shared view of your remote browsers, bot sessions and scraper connections. These features are planned and not available yet.</p>
  <div className={css.roadmapGrid}>
    <article><h3>Remote sessions</h3><p>Run browser sessions on your servers and connect to them from bmux.</p></article>
    <article><h3>Attach to bot sessions</h3><p>Join a remote session to see what your bot is doing and take over when it needs a hand.</p></article>
    <article><h3>Home proxies for scrapers</h3><p>Set up your home connection as a proxy for scrapers running on your servers.</p></article>
    <article><h3>One overview across servers</h3><p>See where your browser automation is running, which sessions are active and which bots need attention.</p></article>
  </div>
</section>

let Install = () => <section className={css.install} id="install" aria-labelledby="install-title">
  <div><h2 id="install-title">Install on macOS</h2><p>Build from source with Node 24, pnpm 11 and Xcode Command Line Tools</p><p className={css.note}>Early preview · Unsigned build</p><a className={css.textLink} href="/docs/readme/#get-started">Full setup instructions</a></div>
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
    <div className={css.commandsHeader}><span>Build the app</span><button type="button" onClick={copyCommands}>Copy commands</button></div>
    <pre tabIndex={0} aria-label="Build commands"><code>{commands}</code></pre>
    <p>Output <code>build/bmux.app</code></p>
    <a className={css.textLink} href="/docs/readme/#custom-output-folder">Choose another output folder</a>
    <span className={css.copyStatus} role="status">{copyStatus}</span>
  </div>
}

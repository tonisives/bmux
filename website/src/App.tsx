import { createContext, useContext, useState } from 'react'
import styles from './App.module.css'

export let App = () => <>
  <a className={styles.skipLink} href="#main">Skip to content</a>
  <Header />
  <main id="main"><Hero /><Features /><Keyboard /><CLI /><Install /><FAQ /></main>
  <Footer />
</>

let GITHUB_URL = 'https://github.com/tonisives/bmux'
type DemoMode = 'split' | 'sessions' | 'automation'
type DemoContextValue = { mode: DemoMode; setMode: (mode: DemoMode) => void; session: string; setSession: (session: string) => void }
let DemoContext = createContext<DemoContextValue | null>(null)
let useDemo = () => useContext(DemoContext)!

let Brand = () => <a className={styles.brand} href="#top" aria-label="bmux home"><span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>bmux<span className={styles.brandCursor}>_</span></a>

let DemoControls = () => {
  let { mode, setMode } = useDemo()
  return <div className={styles.demoControls} aria-label="Explore the workspace demo">
    <span className={styles.demoHint}>TRY THE WORKSPACE</span>
    <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}><span>01</span> Split panes</button>
    <button type="button" aria-pressed={mode === 'sessions'} onClick={() => setMode('sessions')}><span>02</span> Switch sessions</button>
    <button type="button" aria-pressed={mode === 'automation'} onClick={() => setMode('automation')}><span>03</span> Run an agent</button>
  </div>
}

let DocumentPane = () => <div className={styles.documentPane}>
  <div className={styles.docNav}><strong>fieldnotes</strong><span>Guides &nbsp; Reference &nbsp; v2.4</span></div>
  <div className={styles.docContent}>
    <span className={styles.docEyebrow}>THE WORKSPACE GUIDE</span>
    <h3>A little more<br />room to think.</h3>
    <p>Keep your references beside your work.<br />Good ideas need space, not another tab.</p>
    <div className={styles.docRule} />
    <span className={styles.docEyebrow}>01 / GETTING STARTED</span>
    <h4>Everything in context</h4>
    <p>One space for the task in front of you.<br />A separate session for whatever comes next.</p>
    <div className={styles.docNote}>Your place is right where you left it.</div>
  </div>
</div>

let DashboardPane = () => <div className={styles.dashboardPane}>
  <div className={styles.dashboardNav}><strong>orbit<span> / overview</span></strong><span className={styles.profileTag}>work</span></div>
  <span className={styles.dashboardEyebrow}>PROJECT PULSE</span>
  <h3>Looking good.</h3>
  <p>Your corner of the internet, at a glance.</p>
  <div className={styles.metrics}><div><span>Visitors</span><strong>12,804<small>+18.6%</small></strong></div><div><span>Uptime</span><strong>99.98<small>%</small></strong></div></div>
  <div className={styles.chart} aria-label="Illustrative activity chart"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
  <div className={styles.chartLabels}><span>MON</span><span>TODAY</span></div>
  <div className={styles.deployRow}><span className={styles.statusDot} />All systems operational<span>just now</span></div>
</div>

let AgentPane = () => <div className={styles.agentPane}><div className={styles.agentTitle}><span className={styles.statusDot} />BACKGROUND AGENT<span className={styles.profileTag}>bot</span></div><p>Same browser. A separate profile.</p><pre><code><span>$</span> bmux navigate -t tab_42<br />  https://example.com<br /><br /><em>ok: page loaded</em><br /><br /><span>$</span> bmux eval -t tab_42<br />  'document.title'<br /><br /><em>"Example Domain"</em><br /><br /><span>$</span> bmux screenshot -t tab_42<br />  --output /tmp/page.png<br /><br /><em>ok: screenshot saved</em></code></pre><div className={styles.agentFoot}>Your active window stays yours.<span className={styles.cursor} /></div></div>

let SessionOption = ({ name, index }: { name: string; index: number }) => {
  let { setMode, setSession } = useDemo()
  let selectSession = () => { setSession(name); setMode('split') }
  return <button type="button" onClick={selectSession}><span>{index === 0 ? '>' : ' '}</span><strong>{name}</strong><small>{index + 1} windows</small><kbd>↵</kbd></button>
}

let SessionPicker = () => (<div className={styles.sessionOverlay}><div className={styles.sessionPicker}><span className={styles.eyebrow}>ATTACH A SESSION</span><h3>Pick up where you left off.</h3>{['development', 'research', 'personal'].map((name, index) => <SessionOption key={name} name={name} index={index} />)}<p>In bmux: Ctrl B, then S. Enter to attach.</p></div></div>)

let StatusBar = () => {
  let { session } = useDemo()
  return <div className={styles.statusBar}>
    <strong>[{session}]</strong><span>0:workspace*</span><span className={styles.statusMuted}>1:research</span>
    <span className={styles.statusRight}>work <span>│</span> 2 panes <span>│</span> ^B ?</span>
  </div>
}

let DemoPages = () => {
  let { mode } = useDemo()
  return <div className={styles.demoPages}>
    <DocumentPane />{mode === 'automation' ? <AgentPane /> : <DashboardPane />}
    {mode === 'sessions' && <SessionPicker />}
  </div>
}

let WorkspaceDemo = () => {
  let [mode, setMode] = useState<DemoMode>('split')
  let [session, setSession] = useState('development')
  return <DemoContext.Provider value={{ mode, setMode, session, setSession }}>
    <div id="workspace" className={styles.workspaceDemo}>
      <DemoControls />
      <div className={styles.browserShell}><DemoPages /><StatusBar /></div>
      <div className={styles.demoCaption}>
        <span>One browser. Room for your whole workflow.</span>
        <span>Interactive illustration · macOS</span>
      </div>
    </div>
  </DemoContext.Provider>
}

let Header = () => <header id="top" className={styles.header}>
  <div className={styles.nav}>
    <Brand />
    <nav aria-label="Main navigation">
      <a href="#features">Features</a><a href="#keyboard">Keyboard</a>
      <a className={styles.navGithub} href={GITHUB_URL}>GitHub <span aria-hidden="true">↗</span></a>
    </nav>
  </div>
</header>

let Hero = () => <section className={styles.hero} aria-labelledby="hero-title">
  <div className={styles.heroIntro}>
    <a className={styles.releaseBadge} href={`${GITHUB_URL}#get-started`}>
      <span className={styles.statusDot} /> OPEN SOURCE · MACOS · EARLY PREVIEW <span aria-hidden="true">↗</span>
    </a>
    <h1 id="hero-title">tmux for<br />your <span>browser.</span><span className={styles.heroCursor} aria-hidden="true">_</span></h1>
    <div className={styles.heroBottom}>
      <p>Split panes. Persistent sessions. Isolated profiles.<br />The browser for people who live at the keyboard.</p>
      <HeroActions />
    </div>
  </div>
  <WorkspaceDemo />
</section>

let Features = () => <section id="features" className={styles.features}>
  <div className={styles.sectionHeading}>
    <div><span className={styles.eyebrow}>01 / A DIFFERENT KIND OF BROWSER</span><h2>More room for the web.<br />More control for you.</h2></div>
    <p>A familiar engine. A new way to work. <br />Real Chromium pages, arranged around <br />the way you actually use them.</p>
  </div>
  <div className={styles.featureGrid}>
    <article className={styles.featureCard}><div className={styles.splitDiagram} aria-hidden="true"><i /><i /><i /></div><span className={styles.featureNumber}>01 — LAYOUTS</span><h3>Think in panes.</h3><p>Put docs beside your app, dashboards beside your research. Split horizontally or vertically, then save a layout for next time.</p><a href="#workspace">Try the workspace <span aria-hidden="true">↗</span></a></article>
    <article className={styles.featureCard}><SessionDiagram /><span className={styles.featureNumber}>02 — SESSIONS</span><h3>Leave. Come right back.</h3><p>Detach a window and your pages keep running. Reattach to the same session, with live forms and page state right where you left them.</p><a href={`${GITHUB_URL}#model`}>How sessions work <span aria-hidden="true">↗</span></a></article>
    <article className={styles.featureCard}><ProfilesDiagram /><span className={styles.featureNumber}>03 — PROFILES</span><h3>Every account, its own space.</h3><p>Separate logins, cookies, and storage by profile. Mix profiles across panes. Share a login only where you choose the same profile.</p><a href={`${GITHUB_URL}#data-and-permissions`}>Explore profiles <span aria-hidden="true">↗</span></a></article>
  </div>
  <div className={styles.smallFeatures}>
    <div><span className={styles.smallFeatureSymbol}>[ _ ]</span><h3>One quiet status bar</h3><p>Pages fill the window. Controls appear when you ask for them.</p></div>
    <div><span className={styles.smallFeatureSymbol}>~/</span><h3>Bring your bookmarks</h3><p>Import Brave profile names and bookmark folders. Keep their structure.</p></div>
    <div><span className={styles.smallFeatureSymbol}>:set</span><h3>Make the keys yours</h3><p>Edit a small YAML file. Your shortcuts reload while you work.</p></div>
  </div>
</section>

let Keyboard = () => <section id="keyboard" className={styles.keyboardSection}>
  <div className={styles.keyboardCopy}>
    <span className={styles.eyebrow}>02 / MUSCLE MEMORY, INCLUDED</span>
    <h2>Your hands already<br />know what to do.</h2>
    <p>If you know tmux, you are halfway home.<br />Start with the prefix. Follow your instincts.</p>
    <div className={styles.prefixKeys}><kbd>ctrl</kbd><span>+</span><kbd>b</kbd><span>then...</span></div>
    <a className={styles.textLink} href={`${GITHUB_URL}#keyboard`}>All shortcuts and configuration <span aria-hidden="true">↗</span></a>
  </div>
  <div className={styles.keyboardTable}>
    <div><span>Split side by side</span><kbd>%</kbd></div>
    <div><span>Split above and below</span><kbd>"</kbd></div>
    <div><span>New window</span><kbd>c</kbd></div>
    <div><span>Next pane</span><kbd>o</kbd></div>
    <div><span>Switch sessions</span><kbd>s</kbd></div>
    <div><span>Command prompt</span><kbd>:</kbd></div>
    <div><span>Detach. Keep everything running.</span><kbd>d</kbd></div>
  </div>
</section>

let CLI = () => <section className={styles.cliSection}>
  <div className={styles.cliTerminal}>
    <div className={styles.terminalHeading}><span>~/your-next-project</span><span>bmux</span></div>
    <pre><code><span># Give your agent its own session</span>{'\n'}bmux new-session -s agents --profile bot{'\n\n'}<span># Find a pane, then open a tab</span>{'\n'}bmux list-windows -t agents{'\n'}bmux list-panes -t &lt;window-id&gt;{'\n'}bmux tab new --pane &lt;pane-id&gt; https://example.com{'\n\n'}<span># Work with the returned tab ID</span>{'\n'}bmux dom -t &lt;tab-id&gt;{'\n'}bmux screenshot -t &lt;tab-id&gt; --output /tmp/page.png</code></pre>
    <div className={styles.terminalFooter}><span className={styles.statusDot} /> JSON output. Explicit tab IDs. Your focus stays put.</div>
  </div>
  <div className={styles.cliCopy}>
    <span className={styles.eyebrow}>03 / READY FOR YOUR AGENTS</span>
    <h2>A browser you<br />can script.</h2>
    <p>Navigate, inspect the DOM, click, type, and capture screenshots from your terminal. Browser commands work in the background without activating the app.</p>
    <p>Use a bot profile to keep background pages running. Keep your own browsing in another profile.</p>
    <a className={styles.textLink} href={`${GITHUB_URL}/blob/main/AGENT.md`}>Read the automation guide <span aria-hidden="true">↗</span></a>
  </div>
</section>

let Install = () => {
  let [copyStatus, setCopyStatus] = useState('Copy commands')
  let commands = 'git clone https://github.com/tonisives/bmux.git\ncd bmux\npnpm install\npnpm dev'
  let copyCommands = async () => {
    try { await navigator.clipboard.writeText(commands); setCopyStatus('Copied') }
    catch { setCopyStatus('Select the commands to copy') }
  }
  return <section id="install" className={styles.installSection}>
    <span className={styles.eyebrow}>04 / YOUR NEXT WORKSPACE</span>
    <h2>Make some room.</h2>
    <p>Free, open source, and yours to make your own.</p>
    <div className={styles.installBox}>
      <div className={styles.installHeader}><span>Build from source</span><button type="button" onClick={copyCommands} aria-live="polite">{copyStatus}</button></div>
      <pre><code>{commands}</code></pre>
    </div>
    <p className={styles.installRequirements}>macOS · Node.js 22.12+ · pnpm 11</p>
    <p className={styles.installNote}>bmux is an early preview. Builds are currently unsigned and installed locally.<br />Run <code>pnpm package</code> to install the app in <code>~/workspace/_tools</code>.</p>
    <a className={styles.primaryButton} href={GITHUB_URL}>View on GitHub <span aria-hidden="true">↗</span></a>
  </section>
}

let FAQ = () => <section className={styles.faqSection}>
  <div><span className={styles.eyebrow}>A FEW THINGS TO KNOW</span><h2>Before you<br />make the switch.</h2></div>
  <div className={styles.faqList}>
    <details><summary>Is this actually tmux inside a browser?</summary><p>bmux brings the tmux model of sessions, windows, panes, and detachable clients to Chromium. It is a standalone Electron app. You do not need to install tmux.</p></details>
    <details><summary>What happens when I close the window?</summary><p>Detaching or closing a client leaves the server and pages running. Reattaching preserves live page state. Quitting the app stops the browser; relaunching restores layouts and URLs, but reloads pages and cannot restore unsaved forms or JavaScript memory.</p></details>
    <details><summary>Can I bring my Brave profiles?</summary><p>You can import profile names and bookmark folders. Logins, saved passwords, site data, extensions, and Brave settings are not copied. Sign in separately in each bmux profile.</p></details>
    <details><summary>Does it support Chrome extensions?</summary><p>Not yet. The current release also has no cloud sync or built-in ad blocking. DRM media and some platform authentication features may require additional work.</p></details>
    <details><summary>Is bmux free?</summary><p>Yes. The browser and CLI are available under the MIT license. There is no account, subscription, or hosted service required to use bmux.</p></details>
  </div>
</section>

let Footer = () => <footer className={styles.footer}>
  <Brand /><span>Made by <a href="https://tonis.dev">Tõnis</a>. Built with Chromium.</span>
  <div><a href="https://clawtab.cc">Also by Tõnis: ClawTab ↗</a><a href={`${GITHUB_URL}/blob/main/LICENSE`}>MIT License ↗</a></div>
</footer>

let HeroActions = () => <div className={styles.heroActions}>
        <a className={styles.primaryButton} href="#install">Get started <span aria-hidden="true">↗</span></a>
        <a className={styles.secondaryButton} href={GITHUB_URL}>Explore the source <span aria-hidden="true">→</span></a>
      </div>

let SessionDiagram = () => <div className={styles.sessionDiagram} aria-hidden="true"><span>development <b>attached</b></span><span>research <b>running</b></span><span>personal <b>running</b></span></div>

let ProfilesDiagram = () => <div className={styles.profilesDiagram} aria-hidden="true"><span><i>w</i>work</span><span><i>p</i>personal</span><span><i>b</i>bot</span></div>

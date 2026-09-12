import { useState } from 'react'
import css from './SundayPage.module.css'

export let SundayPage = () => <div className={css.page} id="top">
  <a className={css.skipLink} href="#content">Skip to content</a>
  <div className={css.container}>
    <header className={css.header}>
      <a className={css.brand} href="#top">bmux</a>
      <nav aria-label="Main navigation"><a href="#features">Features</a><a href="#install">Install</a><a href={GITHUB}>GitHub</a></nav>
    </header>
    <main id="content"><Hero /><Features /><BrowserTools /><Install /></main>
    <footer className={css.footer}><span>bmux</span><nav aria-label="Footer navigation"><a href={GITHUB}>GitHub</a><a href={`${GITHUB}/blob/main/LICENSE`}>MIT license</a><a href="https://tonis.dev">Made by Tõnis</a></nav></footer>
  </div>
</div>

let GITHUB = 'https://github.com/tonisives/bmux'

let Hero = () => <section className={css.hero}>
  <img className={css.lantern} src="/cdn/icon-512.png" alt="bmux lantern" width="512" height="512" />
  <h1>Browser with split panes, sessions and agent control</h1>
  <p>Chromium for macOS · Free and open source</p>
  <div className={css.heroActions}><a className={css.primaryButton} href="#install">Get bmux</a><a className={css.secondaryButton} href={GITHUB}>View source</a></div>
</section>

let Features = () => <div id="features">
  <section className={css.feature} id="split-panes" aria-labelledby="split-title">
    <div className={css.featureHeading}><div><h2 id="split-title">Split panes</h2><p>Open pages side by side and save your layout</p></div><a className={css.secondaryButton} href={`${GITHUB}#keyboard`}>Keyboard shortcuts</a></div>
    <Capture id="split-panes" alt="Two Chromium pages side by side in bmux, each with its own address bar" />
  </section>
  <section className={css.feature} id="switch-sessions" aria-labelledby="sessions-title">
    <div className={css.featureHeading}><div><h2 id="sessions-title">Switch sessions</h2><p>Keep a workspace for each project</p></div><a className={css.secondaryButton} href={`${GITHUB}#model`}>About sessions</a></div>
    <Capture id="switch-sessions" alt="The bmux session picker showing development, research and personal workspaces" />
  </section>
  <section className={`${css.feature} ${css.agents}`} id="agents" aria-labelledby="agents-title">
    <div className={css.featureHeading}><div><h2 id="agents-title">Run an agent</h2><p>Made for agents that browse, click, type and take screenshots through the CLI, with separate logins and background commands that keep your focus in place</p></div><a className={css.secondaryButton} href={`${GITHUB}/blob/main/AGENT.md`}>Agent guide</a></div>
    <Capture id="run-agent" alt="A task added through the bmux CLI in the bot pane while the human pane stays selected" />
  </section>
</div>

let Capture = ({ id, alt }: { id: string; alt: string }) => <figure className={css.capture}>
  <a href={`/cdn/product/${id}.png`} target="_blank" rel="noreferrer" aria-label={`Open full-size screenshot: ${alt}`}><img src={`/cdn/product/${id}.png`} alt={alt} width="1120" height="663" loading={id === 'split-panes' ? 'eager' : 'lazy'} /></a>
  <figcaption><a href={`/cdn/product/${id}.png`} target="_blank" rel="noreferrer">View full size</a></figcaption>
</figure>

let BrowserTools = () => <section className={css.toolsGrid} aria-label="More features">
  <article><h2>Separate profiles</h2><p>Work, personal and bot logins</p></article>
  <article><h2>Keyboard control</h2><p>Shortcuts you can customize</p></article>
  <article><h2>Browser tools</h2><p>Ad blocking, dark mode and Bitwarden</p></article>
</section>

let Install = () => <section className={css.install} id="install" aria-labelledby="install-title">
  <div><h2 id="install-title">Install on macOS</h2><p>Build from source with Node 24, pnpm 11 and Xcode Command Line Tools</p><p className={css.note}>Early preview · Unsigned build</p><a className={css.textLink} href={`${GITHUB}#get-started`}>Full setup instructions</a></div>
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
    <a className={css.textLink} href={`${GITHUB}#custom-output-folder`}>Choose another output folder</a>
    <span className={css.copyStatus} role="status">{copyStatus}</span>
  </div>
}

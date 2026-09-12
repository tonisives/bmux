import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import css from './DesignPreviews.module.css'

export let DesignPreviews = ({ pathname }: { pathname: string }) => {
  let direction = DIRECTIONS.find(item => pathname.replace(/\/$/, '') === `/styles/${item.id}`)
  if (!direction) return <DesignGallery />
  return <PreviewProvider direction={direction}><DesignPage /></PreviewProvider>
}

let GITHUB = 'https://github.com/tonisives/bmux'
let DIRECTIONS = [
  { id: 'field-notes', number: '01', name: 'Field notes', detail: 'Warm paper. Bookish serifs. A little breathing room.', title: 'A little room\nfor the web.' },
  { id: 'workshop', number: '02', name: 'Workshop', detail: 'Typewriter lettering. Firm edges. Everything within reach.', title: 'YOUR WEB.\nYOUR WORKBENCH.' },
  { id: 'lamplight', number: '03', name: 'Lamplight', detail: 'Deep teal. Peach light. A quieter kind of dark mode.', title: 'Stay awhile.\nKeep your place.' },
] as const
type Direction = typeof DIRECTIONS[number]
type DemoId = 'split-panes' | 'switch-sessions' | 'run-agent'
let DEMOS: { id: DemoId; number: string; label: string; hint: string; title: string; description: string; shortcut: string }[] = [
  { id: 'split-panes', number: '01', label: 'Split panes', hint: 'Keep the docs beside your work', title: 'Two pages. One workspace.', description: 'Real Chromium pages, side by side. Each pane has its own tabs and profile. Split again, resize, or save the layout for tomorrow.', shortcut: 'Ctrl B → %' },
  { id: 'switch-sessions', number: '02', label: 'Switch sessions', hint: 'Pick up where you left off', title: 'A place for every project.', description: 'Open the session picker and move between workspaces. Detach a client and its pages keep running, ready to attach again.', shortcut: 'Ctrl B → S' },
  { id: 'run-agent', number: '03', label: 'Run an agent', hint: 'Let the CLI work in a bot profile', title: 'A second pair of hands.', description: 'In this capture, the bmux CLI types a task and clicks Add in a separate bot profile. The selected pane stays the same.', shortcut: 'bmux type / bmux click' },
]
type PreviewContextValue = { direction: Direction; activeDemo: DemoId; setActiveDemo: (demo: DemoId) => void }
let PreviewContext = createContext<PreviewContextValue | null>(null)
let usePreview = () => useContext(PreviewContext)!
let Lantern = ({ large = false }: { large?: boolean }) => <img className={large ? css.lanternLarge : css.lantern} src={large ? '/cdn/icon-512.png' : '/cdn/icon-180.png?v=lantern'} alt={large ? 'bmux’s teal lantern on a peach tile' : ''} width={large ? 512 : 180} height={large ? 512 : 180} />
let Brand = () => <a className={css.brand} href="/"><Lantern /><span>bmux</span></a>

let PreviewProvider = ({ direction, children }: { direction: Direction; children: ReactNode }) => {
  let [activeDemo, setActiveDemo] = useState<DemoId>('split-panes')
  return <PreviewContext.Provider value={{ direction, activeDemo, setActiveDemo }}>{children}</PreviewContext.Provider>
}

let DesignGallery = () => <div className={`${css.preview} ${css.gallery}`}>
  <header className={css.galleryHeader}><Brand /><a className={css.smallLink} href="/">Current website ↗</a></header>
  <main className={css.galleryMain}>
    <p className={css.eyebrow}>BMUX / THREE DESIGN DIRECTIONS</p>
    <h1>Same little lantern.<br /><em>Three different rooms.</em></h1>
    <p className={css.galleryIntro}>Peach, cream, and teal. Serif and typewriter lettering. Each direction includes real app captures and three clearly marked feature controls.</p>
    <div className={css.directionGrid}>{DIRECTIONS.map(direction => <DirectionCard key={direction.id} direction={direction} />)}</div>
    <p className={css.galleryNote}>Open a direction to try the feature controls, read the page, and compare it on your phone.</p>
  </main>
</div>

let DirectionCard = ({ direction }: { direction: Direction }) => <a className={`${css.directionCard} ${css[direction.id]}`} href={`/styles/${direction.id}/`}>
  <div className={css.cardPreview}><span className={css.eyebrow}>BMUX / {direction.number}</span><Lantern /><h2>{direction.title}</h2><img className={css.cardScreenshot} src="/cdn/product/split-panes.png" alt="Real bmux split-pane workspace" width="1360" height="663" /></div>
  <div className={css.cardDescription}><span>{direction.number} / {direction.name}</span><p>{direction.detail}</p><strong>Explore this direction <span aria-hidden="true">↗</span></strong></div>
</a>

let DesignSwitcher = () => {
  let { direction } = usePreview()
  return <aside className={css.designSwitcher} aria-label="Design comparison"><a href="/styles/">All directions</a><nav aria-label="Choose a design">{DIRECTIONS.map(item => <a key={item.id} href={`/styles/${item.id}/`} aria-current={item.id === direction.id ? 'page' : undefined}>{item.number}<span> {item.name}</span></a>)}</nav><span className={css.previewLabel}>DESIGN PREVIEW</span></aside>
}

let DesignPage = () => {
  let { direction } = usePreview()
  return <div className={`${css.preview} ${css[direction.id]}`}>
    <a className={css.skipLink} href="#content">Skip to content</a>
    <DesignSwitcher />
    <div className={css.pageBody}>
      <header className={css.header}><Brand /><nav aria-label="Main navigation"><a href="#workspace">See it work</a><a href="#agents">For agents</a><a href={GITHUB}>GitHub ↗</a></nav></header>
      <main id="content">
        <Hero />
        <div className={css.belowHero}><span>CHROMIUM UNDERNEATH.</span><span>TMUX IN SPIRIT.</span><span>YOURS TO MAKE YOUR OWN.</span></div>
        <FeatureNotes />
        <Agents />
        <GetStarted />
      </main>
      <footer className={css.footer}><Brand /><p>An independent browser by <a href="https://tonis.dev">Tõnis</a>.</p><a href={`${GITHUB}/blob/main/LICENSE`}>Open source / MIT ↗</a></footer>
    </div>
  </div>
}

let Hero = () => {
  let { direction } = usePreview()
  return <section className={css.hero}>
    <div className={css.heroCopy}>
      <p className={css.eyebrow}>A KEYBOARD-FIRST BROWSER / MACOS</p>
      <h1>{direction.id === 'field-notes' ? <>A little room<br />for <em>the web.</em></> : direction.id === 'workshop' ? <>YOUR WEB.<br />YOUR<br /><em>WORKBENCH.</em></> : <>Stay awhile.<br /><em>Keep your place.</em></>}</h1>
      <p className={css.heroDescription}>Split your browser into panes. Keep a session for each project. Give your agents a place to work.</p>
      <div className={css.heroActions}><a className={css.primaryButton} href="#get-started">Get bmux <span aria-hidden="true">↗</span></a><a className={css.textLink} href={GITHUB}>Browse the source ↗</a></div>
      <p className={css.heroFineprint}>Free & open source. An early preview for macOS.</p>
    </div>
    <div className={css.heroEmblem}><Lantern large /><span>A SMALL LIGHT<br />FOR YOUR WORKSPACE.</span></div>
    <Workspace />
  </section>
}

let DemoButton = ({ demo }: { demo: typeof DEMOS[number] }) => {
  let { activeDemo, setActiveDemo } = usePreview()
  let selectDemo = () => setActiveDemo(demo.id)
  return <button className={css.demoButton} type="button" aria-pressed={activeDemo === demo.id} aria-controls="app-capture" onClick={selectDemo}>
    <span className={css.demoNumber}>{demo.number}</span><span><strong>{demo.label}</strong><small>{demo.hint}</small></span><span className={css.demoArrow} aria-hidden="true">{activeDemo === demo.id ? '↓' : '↗'}</span>
  </button>
}

let Workspace = () => {
  let { activeDemo } = usePreview()
  let demo = DEMOS.find(item => item.id === activeDemo)!
  return <section id="workspace" className={css.workspace} aria-label="Explore bmux features">
    <div className={css.workspaceHeading}><h2>See what bmux does.</h2><span>CHOOSE A FEATURE ↓</span></div>
    <div className={css.demoControls} role="group" aria-label="Choose an app screenshot">{DEMOS.map(item => <DemoButton key={item.id} demo={item} />)}</div>
    <figure className={css.capture} id="app-capture">
      <a className={css.captureLink} href={`/cdn/product/${activeDemo}.png`} target="_blank" rel="noreferrer" aria-label={`Open full-size screenshot: ${demo.label}`}><img src={`/cdn/product/${activeDemo}.png`} alt={`Actual bmux app on macOS: ${demo.title} Local sample handbook and release checklist pages.`} width="1360" height="663" /><span>View full size ↗</span></a>
      <figcaption><span>CAPTURED IN BMUX / MACOS</span><span>Local demo pages · Real app UI</span></figcaption>
    </figure>
    <div className={css.demoExplanation} aria-live="polite" aria-atomic="true"><div><h3>{demo.title}</h3><p>{demo.description}</p></div><code>{demo.shortcut}</code></div>
  </section>
}

let FeatureNotes = () => <section className={css.featureNotes}>
  <div className={css.sectionLead}><p className={css.eyebrow}>A FEW GOOD REASONS</p><h2>Less rearranging.<br /><em>More getting somewhere.</em></h2></div>
  <div className={css.noteGrid}>
    <article><span className={css.noteNumber}>I.</span><h3>Your accounts, apart.</h3><p>Keep work, personal, and bot logins in separate profiles. Each pane chooses its own.</p></article>
    <article><span className={css.noteNumber}>II.</span><h3>Your hands, at home.</h3><p>Split, switch, navigate, and search from the keyboard. Edit your shortcuts in a small YAML file.</p></article>
    <article><span className={css.noteNumber}>III.</span><h3>Your place, kept.</h3><p>Detach and reattach to live pages. Save layouts to bring the arrangement back after a restart.</p></article>
  </div>
  <p className={css.stateNote}>Detached sessions stay live while bmux runs. Quitting the app reloads pages on the next launch.</p>
</section>

let Agents = () => <section id="agents" className={css.agents}>
  <div className={css.agentCopy}><p className={css.eyebrow}>ROOM FOR A SECOND PAIR OF HANDS</p><h2>Made for <em>agents.</em></h2><p>Give your agents a browser that stays out of your way. They can navigate real Chromium pages, inspect the DOM, run JavaScript, click, type, and capture screenshots through the bmux CLI, with JSON output and explicit tab IDs. Isolated profiles keep logins separate; bot profiles keep background pages running. Split panes and saved layouts let you follow their work, and you can detach and reconnect to live sessions without background commands stealing your focus.</p><a className={css.textLink} href={`${GITHUB}/blob/main/AGENT.md`}>Read the automation guide ↗</a></div>
  <div className={css.terminal}><div className={css.terminalLabel}><span>THE CLI / AN EXAMPLE</span><span>bmux</span></div><pre><code><span># A session for your agent</span>{'\n'}bmux new-session -s agents --profile bot{'\n\n'}<span># Use a returned tab ID</span>{'\n'}bmux dom -t &lt;tab-id&gt;{'\n'}bmux type -t &lt;tab-id&gt; \\{'\n'}  --selector '#task' \\{'\n'}  --text 'Check the release notes'{'\n'}bmux click -t &lt;tab-id&gt; \\{'\n'}  --selector '#add-task'</code></pre><p>JSON output. Separate profiles. Your focus stays put.</p></div>
</section>

let GetStarted = () => {
  let [copied, setCopied] = useState(false)
  let [copyError, setCopyError] = useState(false)
  let commands = 'git clone https://github.com/tonisives/bmux.git\ncd bmux\npnpm install\npnpm dev'
  let copy = async () => {
    try { await navigator.clipboard.writeText(commands); setCopied(true); setCopyError(false) }
    catch { setCopyError(true) }
  }
  return <section className={css.getStarted} id="get-started"><div><Lantern /><p className={css.eyebrow}>BRING YOUR OWN CURIOSITY</p><h2>Make yourself<br /><em>some room.</em></h2><p>Free, open source, and ready to build.</p><a className={css.primaryButton} href={GITHUB}>Find bmux on GitHub ↗</a></div><div className={css.install}><div><span>BUILD FROM SOURCE</span><button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy commands'}</button></div><pre><code>{commands}</code></pre><p aria-live="polite">{copyError ? 'Select the commands above to copy them.' : 'macOS · Node.js 22.12+ · pnpm 11'}</p><p>Early preview. Builds are unsigned.<br />Run <code>pnpm package</code> to install locally.</p></div></section>
}

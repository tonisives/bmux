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
  { id: 'sunday', name: 'Sunday', number: '01', description: 'Cream paper · Soft serif · Room to breathe' },
  { id: 'desktop', name: 'Desktop', number: '02', description: 'Mint green · Monospace · One tidy window' },
  { id: 'peach', name: 'Peach', number: '03', description: 'Peach & teal · Big type · A little playful' },
] as const
type Direction = typeof DIRECTIONS[number]
let DEMOS = [
  { id: 'split-panes', label: 'Split panes', caption: 'Keep the docs beside your work', shortcut: 'Ctrl B → %' },
  { id: 'switch-sessions', label: 'Switch sessions', caption: 'A workspace for each project', shortcut: 'Ctrl B → S' },
  { id: 'run-agent', label: 'Run an agent', caption: 'Let an agent work in its own profile', shortcut: 'bmux type / bmux click' },
] as const
type Demo = typeof DEMOS[number]
type PreviewContextValue = { direction: Direction; demo: Demo; setDemo: (demo: Demo) => void }
let PreviewContext = createContext<PreviewContextValue | null>(null)
let usePreview = () => useContext(PreviewContext)!

let PreviewProvider = ({ direction, children }: { direction: Direction; children: ReactNode }) => {
  let [demo, setDemo] = useState<Demo>(DEMOS[0])
  return <PreviewContext.Provider value={{ direction, demo, setDemo }}>{children}</PreviewContext.Provider>
}

let Lantern = () => <img className={css.lantern} src="/cdn/icon-512.png" alt="bmux lantern" width="512" height="512" />
let Brand = () => <a className={css.brand} href="/styles/" aria-label="bmux design previews">bmux</a>
let GetBmux = () => <a className={css.getBmux} href={`${GITHUB}#get-started`}>Get bmux <span aria-hidden="true">↗</span></a>

let DesignGallery = () => <div className={`${css.preview} ${css.gallery}`}>
  <header className={css.galleryHeader}><Brand /><span>Local design previews</span></header>
  <main className={css.galleryMain}>
    <h1>A simpler little website</h1>
    <p>Three fresh directions for bmux</p>
    <div className={css.directionGrid}>{DIRECTIONS.map(direction => <DirectionCard key={direction.id} direction={direction} />)}</div>
  </main>
</div>

let DirectionCard = ({ direction }: { direction: Direction }) => <a className={`${css.directionCard} ${css[direction.id]}`} href={`/styles/${direction.id}/`}>
  <div className={css.cardPreview}>
    <div className={css.cardMasthead}><span>bmux</span><span aria-hidden="true">↗</span></div>
    <CardHero direction={direction} />
    <div className={css.cardDemo}><img src="/cdn/product/split-panes.png" alt="" width="1360" height="663" /></div>
  </div>
  <div className={css.cardDescription}><h3><span>{direction.number}</span> {direction.name}<span aria-hidden="true">↗</span></h3><p>{direction.description}</p></div>
</a>

let CardHero = ({ direction }: { direction: Direction }) => <div className={css.cardHero}><Lantern /><h2>{direction.id === 'sunday' ? <>A little<br /><em>more room</em></> : direction.id === 'desktop' ? <>Your browser,<br />in good order</> : <>Space for<br />you & your<br /><em>agents</em></>}</h2></div>

let DesignSwitcher = () => {
  let { direction } = usePreview()
  return <aside className={css.designSwitcher} aria-label="Design comparison"><a href="/styles/">All designs</a><nav aria-label="Choose a design">{DIRECTIONS.map(item => <a key={item.id} href={`/styles/${item.id}/`} aria-current={item.id === direction.id ? 'page' : undefined}><span>{item.number}</span> {item.name}</a>)}</nav></aside>
}

let DesignPage = () => {
  let { direction } = usePreview()
  return <div className={`${css.preview} ${css[direction.id]}`}>
    <a className={css.skipLink} href="#content">Skip to content</a>
    <DesignSwitcher />
    {direction.id === 'sunday' ? <SundayPage /> : direction.id === 'desktop' ? <DesktopPage /> : <PeachPage />}
  </div>
}

let Header = () => <header className={css.header}><Brand /><nav aria-label="Main navigation"><span>Browser for macOS</span><a href={GITHUB}>GitHub ↗</a></nav></header>
let Footer = () => <footer className={css.footer}><span>Free & open source</span><a href="https://tonis.dev">Made by Tõnis ↗</a><span>macOS · Early preview</span></footer>

let SundayPage = () => <div className={css.sundayPage}>
  <Header />
  <main id="content">
    <section className={css.sundayHero}><Lantern /><h1>A little <em>more room</em></h1><p>Your pages, projects and agents, together</p><GetBmux /></section>
    <section className={css.sundayWorkspace} aria-label="Explore bmux features"><DemoControls /><Capture /></section>
    <Agents />
  </main>
  <Footer />
</div>

let DesktopPage = () => <div className={css.desktopPage}>
  <Header />
  <main id="content" className={css.desktopWindow}>
    <div className={css.windowTitle}><span className={css.windowMark} aria-hidden="true" /><span>bmux / a home for your tabs</span><span className={css.windowLine} aria-hidden="true" /></div>
    <div className={css.desktopLayout}>
      <DesktopIntro />
      <section className={css.desktopWorkspace} aria-label="Explore bmux features"><DemoControls /><Capture /></section>
    </div>
    <Agents />
  </main>
  <Footer />
</div>

let DesktopIntro = () => <section className={css.desktopIntro}><Lantern /><h1>Your browser,<br />in good order</h1><p>Split the view<br />Keep your place<br />Bring an agent</p><GetBmux /></section>

let PeachPage = () => <>
  <div className={css.peachTop}><Header /></div>
  <main id="content">
    <PeachHero />
    <section className={css.peachWorkspace} aria-label="Explore bmux features"><div className={css.peachWorkspaceInner}><DemoControls /><Capture /></div></section>
    <div className={css.peachBottom}><Agents /></div>
  </main>
  <div className={css.peachBottom}><Footer /></div>
</>

let PeachHero = () => <section className={css.peachHero}><div><h1>Space for you<br />& your <em>agents</em></h1><p>A browser with a place for everything</p><GetBmux /></div><div className={css.peachLantern}><Lantern /></div></section>

let FeatureIcon = ({ id }: { id: Demo['id'] }) => <svg className={css.featureIcon} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
  {id === 'split-panes' ? <><rect x="2.5" y="3.5" width="15" height="13" rx="1" /><path d="M10 4v12" /></> : id === 'switch-sessions' ? <><rect x="6" y="6" width="11" height="11" rx="1" /><path d="M13 4V3H3v10h1" /></> : <><path d="m3 5 5 5-5 5m8 0h6" /></>}
</svg>

let DemoButton = ({ demo }: { demo: Demo }) => {
  let { demo: activeDemo, setDemo } = usePreview()
  let selectDemo = () => setDemo(demo)
  return <button className={css.demoButton} type="button" aria-pressed={activeDemo.id === demo.id} aria-controls="app-capture" onClick={selectDemo}><FeatureIcon id={demo.id} /><span>{demo.label}</span></button>
}

let DemoControls = () => <div className={css.demoControls} role="group" aria-label="Choose an app screenshot">{DEMOS.map(demo => <DemoButton key={demo.id} demo={demo} />)}</div>

let Capture = () => {
  let { demo } = usePreview()
  return <figure id="app-capture" className={css.capture}>
    <a className={css.captureLink} href={`/cdn/product/${demo.id}.png`} target="_blank" rel="noreferrer" aria-label={`Open real app screenshot: ${demo.label}`}><img src={`/cdn/product/${demo.id}.png`} alt={`bmux on macOS — ${demo.caption.toLowerCase()}, using local demo pages`} width="1360" height="663" /><span>Real app capture ↗</span></a>
    <figcaption aria-live="polite" aria-atomic="true"><span>{demo.caption}</span><code>{demo.shortcut}</code></figcaption>
  </figure>
}

let Agents = () => <section className={css.agents} aria-labelledby="agents-title"><h2 id="agents-title">Made for agents</h2><div><p>Navigate, click, type and take screenshots through the CLI, with separate profiles, saved workspaces and JSON output — all without taking your focus</p><a href={`${GITHUB}/blob/main/AGENT.md`}>Explore the CLI ↗</a></div></section>

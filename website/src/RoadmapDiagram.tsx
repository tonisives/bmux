import { useState } from 'react'
import css from './RoadmapDiagram.module.css'

type DiagramKind = 'remote' | 'attach' | 'proxy' | 'overview'

export let RoadmapDiagram = ({ kind }: { kind: DiagramKind }) => {
  let [paused, setPaused] = useState(false)
  let toggleAnimation = () => setPaused(value => !value)
  return <figure className={css.diagram} data-paused={paused}>
    <div className={css.diagramHeader}><span>Planned workflow</span><button type="button" onClick={toggleAnimation} aria-pressed={paused} aria-label={`${paused ? 'Play' : 'Pause'} animation: ${captions[kind]}`}>{paused ? 'Play' : 'Pause'}</button></div>
    <div className={css.canvas} role="img" aria-label={captions[kind]}>
      <Flow kind={kind} />
    </div>
    <figcaption>{captions[kind]}</figcaption>
  </figure>
}

let captions = {
  remote: 'Connect from your laptop to a browser running on your server.',
  attach: 'You and your bot can connect to the same remote browser session.',
  proxy: 'Scraper requests travel from your server through your home proxy to a website.',
  overview: 'Updates from several servers meet in one bmux overview.',
}

let Flow = ({ kind }: { kind: DiagramKind }) => <div className={`${css.flow} ${kind === 'proxy' ? css.proxy : ''}`} aria-hidden="true">
        {kind === 'remote' && <><Node label="Your laptop" detail="bmux" icon="browser" /><Connection label="connect" /><Node label="Your server" detail="Remote browser" icon="server" active /></>}
        {kind === 'attach' && <><div className={css.sources}><Node label="Bot" detail="Automating" icon="bot" /><Node label="You" detail="Join / take over" icon="browser" /></div><Connection label="attach" branched /><Node label="Shared session" detail="Remote browser" icon="browser" active /></>}
        {kind === 'proxy' && <><Node label="Scraper" detail="Your server" icon="server" /><Connection label="request" /><Node label="Home proxy" detail="Your connection" icon="home" active /><Connection label="forward" delayed /><Node label="Website" detail="Destination" icon="browser" /></>}
        {kind === 'overview' && <><div className={css.sources}><Node label="Server A" detail="Bot running" icon="server" /><Node label="Server B" detail="Needs attention" icon="server" /></div><Connection label="updates" branched /><Node label="bmux" detail="All sessions" icon="overview" active /></>}
      </div>

let Node = ({ label, detail, icon, active = false }: { label: string; detail: string; icon: 'browser' | 'server' | 'bot' | 'home' | 'overview'; active?: boolean }) => <div className={`${css.node} ${active ? css.active : ''}`}>
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    {icon === 'browser' && <><rect x="4" y="6" width="24" height="20" rx="3" /><path d="M4 12h24M9 9h1m3 0h1M10 18h12m-12 4h7" /></>}
    {icon === 'server' && <><rect x="5" y="5" width="22" height="9" rx="2" /><rect x="5" y="18" width="22" height="9" rx="2" /><path d="M10 9h1m4 0h7M10 22h1m4 0h7M16 14v4" /></>}
    {icon === 'bot' && <><rect x="6" y="10" width="20" height="17" rx="5" /><path d="M16 5v5M12 22h8M3 16v5m26-5v5" /><circle cx="12" cy="16" r="1" /><circle cx="20" cy="16" r="1" /></>}
    {icon === 'home' && <><path d="m3 15 13-11 13 11M7 12v15h18V12M13 27v-9h6v9" /></>}
    {icon === 'overview' && <><rect x="4" y="5" width="24" height="22" rx="3" /><path d="M4 11h24M15 11v16M15 19h13M8 16h3m-3 5h3m8-6h5m-5 8h5" /></>}
  </svg>
  <strong>{label}</strong><small>{detail}</small>
</div>

let Connection = ({ label, branched = false, delayed = false }: { label: string; branched?: boolean; delayed?: boolean }) => <div className={`${css.connection} ${branched ? css.branched : ''} ${delayed ? css.delayed : ''}`}>
  <span>{label}</span><div className={css.track}><i /></div>
</div>

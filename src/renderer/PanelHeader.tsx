import { createContext, useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { CloseButton } from './CloseButton'
import css from './PanelHeader.module.css'

export type PanelBack = { label: string; run: () => void }
export let PanelBackContext = createContext<(back: PanelBack | null) => void>(() => undefined)

export let usePanelBack = (back: PanelBack | null) => {
  let setBack = useContext(PanelBackContext)
  useEffect(() => {
    setBack(back)
    return () => setBack(null)
  }, [back, setBack])
}

export let BackButton = ({ back }: { back: PanelBack }) => {
  let ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { ref.current?.focus() }, [back.label])
  return <button ref={ref} className={css.back} type="button" onClick={back.run} aria-label={back.label} title={back.label}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5 6 8l4.5 4.5" /></svg>
  </button>
}

export let PanelHeader = ({ children, back, dismiss }: { children: ReactNode; back?: PanelBack | null; dismiss: () => void }) => <header>
  <div className={css.heading}>{back && <BackButton back={back} />}{children}</div>
  {!back && <CloseButton label="Close" onClick={dismiss} />}
</header>

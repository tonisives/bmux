import css from './CloseButton.module.css'

type CloseButtonProps = { label: string; onClick: () => void; disabled?: boolean }

export let CloseButton = ({ label, onClick, disabled }: CloseButtonProps) => <button className={css.button} type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
</button>

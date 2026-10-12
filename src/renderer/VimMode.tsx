import css from './VimMode.module.css'

export let VimMode = ({ mode, label }: { mode: string; label: string }) => <span className={css.mode} data-vim-indicator aria-label={label}>{mode}&gt;</span>

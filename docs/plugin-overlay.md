# Plugin page overlays

Manual plugin actions with the `ui` capability can publish a page overlay above their original pane. It is a separate native view: the website cannot access its controls, and page screenshots contain only the website. Hooks cannot open page overlays. Updating a page overlay never activates a window or changes the selected pane.

Use `host('overlay.update', content)` to replace its bounded, text-only model. Content accepts an optional `icon` (`accounts`, `plugin`, `chart` or `search`) and has `title`, `subtitle`, `status`, `nodes` (title, lines and cyan/green/neutral tone), `metrics`, optional expandable `details`, and `controls`. Controls have unique IDs, labels and a kind: button, toggle, choice or text. Choice controls include choices; all non-button controls include a value. Poll `host('overlay.events')` for validated `{ id, value }` inputs. Acknowledgement means queued; publish the actual resulting state after applying an input.

Each pane has one shared overlay view with icon tabs at the top right. Plugins, agent control and locked viewport settings use the same panel. Click a tab to open it; click the selected tab again to collapse it to the icon strip. Drag the header to move the panel, or resize every tab together from the top right corner. The resize handle also accepts arrow keys. The panel keeps one size when switching tabs. Each visible pane has its own overlay, including panes that are not selected. Overlays follow their page zoom, including their controls and collapsed height. The header can be dragged within its own pane; resizing and zoom changes keep the popup inside that pane. Each client retains its own pane placement. An ended action retains its final page overlay with a confirmed restart option. Restart uses the original action and non-password parameters in the same profile; actions must still obtain their own browsing approval.

Use overlays for plugin controls, settings, progress and results. Keep summaries short. Put complete prompts, responses and logs in expandable details. Never publish credentials in the overlay model.

## Included AI bridge

The separate `ai.decisions` capability permits manual scripts to query `decisions.usage` and submit `decisions.create` with `{requestId,payload}`. BMUX uses the signed-in subscription; scripts never receive the account token or provider key. The service enforces a shared monthly allowance and bounded gpt-6-luna request shape. Hooks cannot spend the allowance. A host or service without this feature returns an error; callers should pause and offer Train mode or a personal key.

The minimize button collapses to a 32px icon strip. Click a tab to restore the panel. Different plugins retain separate tabs; a newer run from the same plugin replaces its earlier tab. Confidence labels show the percentage without duration explanations. Errors reopen the detailed view for recovery.


Social browsing can provide a decision tree with per-option probabilities,
loading state, and selected paths. The full view shows the post excerpt and
places settings and usage in footer popups. Usage includes interaction counts,
AI allowance and estimated costs reported by the plugin. Playback and next-post controls remain within the plugin tab.

The bottom of the plugin list has an agent playback menu and a Next button for
the current pane. Next overrides the current AI decision; the shared feed runner
interrupts the watch or request before advancing without post interactions.

The host uses one sandboxed native view per pane and delivers only changed overlay data. Inactive tabs do not mount their UI. Flat surfaces use no background blur or continuous layout animations. Agent input interception and viewport pan gestures remain separate from panel content.

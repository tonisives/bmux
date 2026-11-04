# Plugin page overlays

Manual plugin actions with the `ui` capability can publish a page overlay above their original pane. It is a separate native view: the website cannot access its controls, and page screenshots contain only the website. Hooks cannot open page overlays. Updating a page overlay never activates a window or changes the selected pane.

Use `host('overlay.update', content)` to replace its bounded, text-only model. Content has `title`, `subtitle`, `status`, `nodes` (title, lines and cyan/green/neutral tone), `metrics`, optional expandable `details`, and `controls`. Controls have unique IDs, labels and a kind: button, toggle, choice or text. Choice controls include choices; all non-button controls include a value. Poll `host('overlay.events')` for validated `{ id, value }` inputs. Acknowledgement means queued; publish the actual resulting state after applying an input.

Page overlays can be dragged by their header, resized from their bottom corner, and collapsed. Bounds stay inside the selected pane when the window changes size. Each client retains its own pane placement. An ended action retains its final page overlay with a confirmed restart option. Restart uses the original action and non-password parameters in the same profile; actions must still obtain their own browsing approval.

Use overlays for plugin controls, settings, progress and results. Keep summaries short. Put complete prompts, responses and logs in expandable details. Never publish credentials in the overlay model.

## Included AI bridge

The separate `ai.decisions` capability permits manual scripts to query `decisions.usage` and submit `decisions.create` with `{requestId,payload}`. BMUX uses the signed-in subscription; scripts never receive the account token or provider key. The service enforces a shared monthly allowance and bounded gpt-6-luna request shape. Hooks cannot spend the allowance. A host or service without this feature returns an error; callers should pause and offer Train mode or a personal key.

The Compact button switches to a 160px overlay showing AI decision percentages, the current action, and the session pause or resume control. Details restores the full overlay. Collapsing still reduces either view to its header. Errors reopen the detailed view for recovery.

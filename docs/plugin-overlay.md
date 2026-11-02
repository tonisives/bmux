# Visual plugin observer

Manual plugin actions with the `ui` capability can publish an observer above their original pane. It is a separate native view: the website cannot access its controls, and page screenshots contain only the website. Hooks cannot open observers. Updating an observer never activates a window or changes the selected pane.

Use `host('overlay.update', content)` to replace its bounded, text-only model. Content has `title`, `subtitle`, `status`, `nodes` (title, lines and cyan/green/neutral tone), `metrics`, optional expandable `details`, and `controls`. Controls have unique IDs, labels and a kind: button, toggle, choice or text. Choice controls include choices; all non-button controls include a value. Poll `host('overlay.events')` for validated `{ id, value }` inputs. Acknowledgement means queued; publish the actual resulting state after applying an input.

Observers can be dragged by their header, resized from their bottom corner, and collapsed. Bounds stay inside the selected pane when the window changes size. Each client retains its own pane placement. An ended action retains its final observer with a confirmed restart option. Restart uses the original action and non-password parameters in the same profile; actions must still obtain their own browsing approval.

Keep post and decision summaries short. Put complete prompts, responses and logs in expandable details. Never publish credentials in the observer model.

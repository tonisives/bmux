# Dialog styling

bmux-owned confirmations and update messages use the browser chrome's
`MessageDialog`. The page stays visible under a dimmed backdrop. Escape chooses
the cancel action and Enter chooses the default action; button labels show those
shortcuts. Update restart confirmations keep Later as the default so Enter does
not unexpectedly restart the browser.

| Source | Presentation | Reason |
| --- | --- | --- |
| `dialog.confirm` command | bmux | An application-owned, asynchronous confirmation |
| Manual update results, update errors, update preference errors, restart confirmation | bmux | Application-owned messages supplied through `showMessageDialog` |
| bmux URL entry, history, reload, tab and window close with unsaved changes | bmux | The unload guard can cancel and repeat the same browser operation after confirmation |
| Website or extension JavaScript `alert()` and `confirm()` | Native | Electron owns their synchronous browser semantics, frame lifetime, cancellation, and repeated-dialog protection |
| Site-initiated navigation with unsaved changes | Native | Its synchronous unload decision must preserve the original request, including form submission bodies |
| File selection, file saving, OS permissions and system UI | Native | Platform-managed operations |
| Application-menu message when no browser window is visible | Native fallback | No browser chrome is available to show the message |
| Fatal Electron errors before or without working browser chrome | Native | A renderer dialog may be unavailable |

The Bitwarden warning about disabling its inline menu is an extension-generated
JavaScript alert, rather than a bmux error message. Electron 44.3.0 handles these
through the private `-run-dialog` and `-cancel-dialogs` events in
[its webContents implementation](https://github.com/electron/electron/blob/v44.3.0/lib/browser/api/web-contents.ts).
There is no supported public custom JavaScript-dialog handler. Do not replace
those private listeners, patch global Electron dialog functions, or override
`alert()`/`confirm()` in page scripts merely to change styling. Doing so would
couple bmux to Electron internals or change website and extension behavior.

The trusted dialog response is bound to its client and request ID. A closed
client or a replacement dialog cancels the pending request rather than leaving
an operation waiting or granting consent to another request.

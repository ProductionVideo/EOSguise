# Changelog

## 0.1.3

- Show the newly triggered Eos cue immediately while its fade is running; unnamed active cues remain visible.
- Keep cue catalogues intact during refresh and same-console reconnects, and keep the current cue visible with Auto-follow enabled.
- Support keyboard cue entry, Enter to send, Backspace to edit and Escape to clear. Successful sends clear the entry for the next cue.
- Reject missing cues with a clear error; preserve the entry on failure and avoid sending while the catalogue is unavailable.
- Add regression tests for fading cue feedback, cue-list following, reconnects and keyboard controls.
- Show each cue's time in the Overview cue lists, Eos style ("5", or "5 / 3" when up and down differ), with a "Cue times" tickbox to hide the column.

## 0.1.2

First public EOSguise release.

- Eos current/next cue feedback, two searchable cue lists and Go to Cue with decimal cues.
- Disguise Live Update subscriptions, selectable transport and HTTP transport controls.
- Saved endpoint settings and per-adapter sharing checkboxes.
- Independent Windows runtime, startup entry and background process supervisor.
- Loopback/mock integration tests.

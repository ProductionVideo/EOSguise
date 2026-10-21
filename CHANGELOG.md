# Changelog

## 0.1.3

- Renamed EOSguise to cuedo, with the cuedo wordmark and icon. Existing installs keep their config; Start.cmd recognises a running pre-rename instance and Install-Startup.cmd replaces the old shortcut.
- Show the newly triggered Eos cue immediately while its fade is running; unnamed active cues remain visible.
- Keep cue catalogues intact during refresh and same-console reconnects, and keep the current cue visible with Auto-follow enabled.
- Support keyboard cue entry, Enter to send, Backspace to edit and Escape to clear. Successful sends clear the entry for the next cue.
- Reject missing cues with a clear error; preserve the entry on failure and avoid sending while the catalogue is unavailable.
- Add regression tests for fading cue feedback, cue-list following, reconnects and keyboard controls.
- Fix Disguise Live Update never connecting for transports whose UID exceeds the signed 64-bit range: subscribe with getByUID in hex instead of decimal.
- Keep the Live Update connection open when Designer rejects a property, treat any Live Update message as liveness, and match subscriptions regardless of path spacing or id type.
- Show why the Director is disconnected on the Overview and Disguise pages and in error.log.

- Optional public status website (cues.stage.wiki): enable with just a show name in Settings. Status and catalogue size limits are 16 KB and 1 MB. Outbound-only, allowlisted telemetry; local controls and hardware are unaffected by cloud problems. The dashboard lists shows, shows current/next cues, cue lists with times and Disguise status, and lets visitors delete a listing.

## 0.1.2

First public EOSguise release.

- Eos current/next cue feedback, two searchable cue lists and Go to Cue with decimal cues.
- Disguise Live Update subscriptions, selectable transport and HTTP transport controls.
- Saved endpoint settings and per-adapter sharing checkboxes.
- Independent Windows runtime, startup entry and background process supervisor.
- Loopback/mock integration tests.

# Build the Cues dashboard and EOSguise publisher

Implement the application described below. Infrastructure is already provisioned; preserve it. The user specifically asked Claude to do the dashboard and runtime coding. Codex prepared Firebase, DNS, this contract, and a holding page. No EOSguise source files have been modified or pushed.

## Outcome

Public website at https://cues.stage.wiki with a live list of shows. Click a show to see current Eos cues, the two configured cue lists and selected Disguise transport status. A Delete button removes the cloud listing and detail. A running publisher's next activity/heartbeat recreates both, including its catalogue. No account, per-show key, certificate installation, manual registration or pairing step. The operator enters one show name in EOSguise Settings and enables publishing.

No remote Go, Goto, transport, fade, settings or any other show-control capability. Local controls continue working as before.

## Provisioned resources

| Resource | Value |
| --- | --- |
| Firebase project / Hosting site | `stagewiki-cues` |
| Project number | `414602027201` |
| Firebase console | https://console.firebase.google.com/project/stagewiki-cues/overview |
| Default hosting URL | https://stagewiki-cues.web.app |
| Custom domain | https://cues.stage.wiki |
| Database region | `europe-west1` (Belgium) |
| Database base URL | `https://stagewiki-cues-default-rtdb.europe-west1.firebasedatabase.app` |
| Web app ID | `1:414602027201:web:eac05064437f3ab030f440` |
| DNS | Squarespace, `cues CNAME stagewiki-cues.web.app`, TTL 4 hours |

`public/firebase-config.json` is public SDK configuration, not an admin credential. REST does not require it or any key. No service-account keys were created. The project was created without linking a billing account; stay within the Spark plan unless the user explicitly chooses otherwise. Firebase manages browser HTTPS certificates centrally.

See `SETUP-STATUS.md` for domain/certificate state and `verification.json` for live infrastructure checks. The currently deployed page is explicitly a holding page, not a working dashboard.

## Repository findings

Read https://github.com/ProductionVideo/EOSguise at the latest applicable branch. Codex inspected main at commit `5bb2e3502202540c02d35787744430f914b141c8` on 21 October 2026; version file/README says 0.1.2. Confirm the correct branch before coding if the checkout differs; preserve any newer changes.

- `server.mjs`: Node ESM; `state.eos`, `state.disguise`, and `catalogue` already hold cached feedback. GET `/api/state` and `/api/cues` demonstrate the shapes. Export from memory rather than making another console/Director connection or polling the web server.
- `state.eos.lists` is keyed by configured list number. Each list has `name`, `current`, `next`; current/next can be null and otherwise contain cue `number` (string), `name`, `notes`, `duration`, `remaining`. The current cue changes at fade start. Keep that behavior.
- `/api/cues` filters `catalogue.values()` to `part === 0`, sorted by list and numeric cue number. Entries include `list`, `number`, `part`, `name`, `up`, `down`; fade times are milliseconds. Keep point cue numbers as strings.
- `disguise-live.mjs` calls a callback with `connected`, `transport`, `track`, `cue`, `time`, `section`, `sectionName`, `sectionTime`, `engaged`, `playmode`, `brightness`, `output`, `updated`, plus diagnostics. UID handling uses BigInt to build hex expressions: preserve that fix.
- `settings.mjs`, `settings.js`, `settings.html`: extend settings validation, persistence and UI. Current settings save rediscovers the Director and reconnects Eos; make a publish-only change work even if hardware is offline. Avoid restarting working hardware connections for just a show-name/publishing change.
- `config.example.json` is copied on first launch. Existing configs must continue working without cloud settings. Default publishing OFF and name empty. Built-in production database URL; operator setup is just show name and enable. Do not allow a public webpage to change local config.
- `web-eos.mjs`, `eos-control.mjs`, `web-disguise.mjs`: local control code. Do not import these into any cloud publisher or website bundle.
- Standalone Windows runtime is Node 22+ with vendored `ws`, no npm install requirement on show machines. Use built-in `fetch`, `AbortSignal`, `crypto`; preserve launchers, startup supervisor and shutdown behavior.

## One-way boundary

```
Eos + Disguise <-> existing EOSguise runtime on trusted LAN
                           |
                    outbound HTTPS snapshots
                           v
                 Firebase Realtime Database
                           |
                    public status reads
                           v
                   browser on Firebase Hosting
```

No port forwarding, inbound listener, tunnel, proxy to the runtime, cloud command queue, OSC gateway or runtime subscription to cloud commands. The publisher may read its own cloud records for existence/catalogue checks; it must never interpret those records as instructions or copy them into local settings. Ignore HTTP response payloads except expected acknowledgements/existence metadata. Website delete only changes cloud data and never disables local publishing.

Construct an explicit allowlist of telemetry. Never upload config.json, local addresses, hostnames, Director URLs, network interfaces, action logs, raw errors/stack traces, arbitrary settings, credentials or diagnostics. Cue labels/notes and show names become public; publishing is opt-in. All cloud data is untrusted: parse defensively, validate types/counts/lengths, render text safely without HTML injection, and never execute data.

## Identity

Display name: NFKC-normalize, trim, collapse whitespace to one space; reject empty or over 120 characters. Canonical name is that display name lowercased with JavaScript `toLowerCase()` (not locale-specific). `showId = SHA-256(UTF-8(canonicalName))`, lowercase 64-character hex. Use identical logic in runtime, website and tests. Do not use the raw name as a database key (Firebase forbids several characters).

Names that differ only by case/spacing/NFKC normalization intentionally share one ID. Same canonical name means the same public show. Names are identifiers, not secrets. No authenticated ownership is promised. Anyone can overwrite/spoof a known show or delete it. Do not claim otherwise. Different publishers using the same name will compete; show a clear local hint to choose distinct names. A random per-process `sessionId` and increasing `sequence` support diagnostics/order handling; neither authenticates the publisher. Serialize outbound writes so slow older writes cannot overwrite newer ones from the same process. Changing show name publishes a new ID; leave old listing removable using Delete.

## Deployed v1 database contract

`database.rules.json` has been deployed. Public root read/write is denied. Public summary reads are allowed at `/shows`; detail reads only at `/showData/{showId}`. Individual show records can be written/deleted without credentials; unknown fields, invalid IDs, malformed envelopes and oversized strings are rejected. There is no public `/commands` or `/settings` path. Individual records can be deleted; ancestor deletes are denied.

The small index and large details are separate so loading the show directory does not download every catalogue. `stateJson` and `cuesJson` are JSON-encoded strings to provide explicit size bounds with simple RTDB rules. The rules validate the envelope and string lengths, not parsed JSON contents. Validate parsed content in both app components. If you change the contract, update rules, examples, docs and tests together before deployment; do not relax the root rules.

`/shows/{showId}` (all fields required, no extra fields):

```json
{"schemaVersion":1,"name":"Example Show","updatedAt":{".sv":"timestamp"},"sessionId":"random UUID for this runtime process","sequence":1,"eosConnected":true,"disguiseConnected":true}
```

`/showData/{showId}` (all fields required, no extra fields):

```json
{"schemaVersion":1,"updatedAt":{".sv":"timestamp"},"stateJson":"{\"eos\":{\"connected\":false,\"lists\":{}},\"disguise\":{\"connected\":false}}","cuesJson":"[]","catalogueHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}
```

`catalogueHash` is lowercase SHA-256 of the exact UTF-8 `cuesJson` string. `stateJson` maximum 65,536 characters; `cuesJson` maximum 4,194,304 characters; `sessionId` maximum 64. Use `JSON.stringify()` with stable catalogue ordering. Never silently drop cues to meet a limit; report a clear publishing error locally while local show operation continues. On fresh startup, publish `[]` if there is no catalogue yet; retain last-known catalogue during refresh/reconnect to the same console as the existing app does, while showing connection/refresh status accurately.

Full publish: one atomic root PATCH to `<databaseURL>/.json` containing:

```json
{"shows/SHOW_ID":{"schemaVersion":1,"name":"Example Show","updatedAt":{".sv":"timestamp"},"sessionId":"SESSION_UUID","sequence":1,"eosConnected":false,"disguiseConnected":false},"showData/SHOW_ID":{"schemaVersion":1,"updatedAt":{".sv":"timestamp"},"stateJson":"{\"eos\":{\"connected\":false,\"lists\":{}},\"disguise\":{\"connected\":false}}","cuesJson":"[]","catalogueHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}}
```

Replace placeholders in paths/values. Use `Content-Type: application/json`. No Authorization header, secret, or per-show Firebase app is needed. RTDB resolves server timestamps to milliseconds; always send the timestamp sentinel for each changed envelope. Unknown fields under a show envelope are denied.

Heartbeat/state-only publish: atomic root PATCH with full `shows/SHOW_ID` summary, `showData/SHOW_ID/updatedAt`, and `showData/SHOW_ID/stateJson`. Keep existing `cuesJson`/`catalogueHash`. On first publish, catalogue change, reconnect after failed cloud writes, or any missing cloud record, full-publish both records. If a heartbeat fails validation because Delete removed details, retry once with a full snapshot; repeated errors go through backoff. This makes Delete followed by activity restore the catalogue without waiting for a console catalogue change. Do not endlessly treat all permission failures as missing data.

Delete: one atomic root PATCH:

```json
{"shows/SHOW_ID":null,"showData/SHOW_ID":null}
```

Update the UI only after confirmed success. Failed/offline deletion keeps the listing and offers retry. Deleting cloud data does not stop the show. An active show may return within one heartbeat; explain that next to Delete. Do not leave tombstones, blocklists, disabled flags or registrations. A show that has stopped publishing stays deleted.

## Runtime publisher requirements

- Small isolated module (suggest `cloud-publisher.mjs`) with injected snapshot getter, clock and HTTP client for tests. Disabled by default; no changes to LAN listeners.
- Publish meaningful current/next/list/transport changes promptly, coalesced to at most one request per second. Heartbeat every 10 seconds while enabled, even with Eos/Disguise disconnected. Avoid publishing high-frequency timer values hundreds of times per second.
- State-only updates must not resend the catalogue. Catalogue is sent on change or full recovery. Keep at most the latest pending state; no unbounded offline queue.
- Outbound timeouts (e.g. 5 seconds), one request in flight, bounded exponential backoff with jitter (cap 60 seconds). Local controls, hardware feedback and settings must stay responsive during cloud failure.
- On name change, disable/re-enable, settings reload or shutdown, cancel obsolete timers/pending requests. Do not let a late write republish an old name after a new publisher is selected. Keep machine/process lifetime behavior correct.
- Show publisher status separately in local Settings: disabled, publishing, connected to cloud, retrying, last success, sanitized error. Do not infer Eos/Director health from cloud availability.
- Keep current cue labels/notes, next cue and catalogue consistent. Publish only selected Disguise telemetry. Omit internal transport UID and raw diagnostics unless there is a concrete display need.

## Dashboard requirements

- Replace `public/` holding page with the real responsive, accessible dashboard. Buildless HTML/CSS/JS or a small static build are both suitable. If adding a build step, update `firebase.json` public directory and deployment docs. Keep the website separate from local EOSguise assets.
- Live directory with show names, last update and independent Eos/Disguise status. Search and sort are useful. Show detail has a stable shareable URL (e.g. `/show/SHOW_ID`), back navigation, current/next cues for configured lists, searchable cue catalogue, optional fade times and auto-follow, selected Disguise transport/track/section/cue/playmode and timing.
- Prefer RTDB SDK listeners or REST streaming to repeated whole-catalogue polling. Load detail only for the selected show; subscribe separately to `stateJson` and `cuesJson` to avoid retransmitting the catalogue on heartbeats. Clean up listeners on navigation. Keep only one summary listener per page.
- Distinguish publisher freshness, Eos connection, Disguise connection, and browser-to-Firebase connection. Fresh <=30 seconds; stale >30 seconds; offline >120 seconds. Derive age with server time offset (`/.info/serverTimeOffset` via SDK) or another documented clock strategy. Advance freshness even if no events arrive. Freeze/label stale timing, never imply live countdown after source/browser disconnect.
- Empty, loading, offline, permission error, deleted-show and invalid JSON states must be understandable. Direct navigation to missing show should recover if that ID reappears. Avoid duplicate rows on reconnect.
- One-click Delete as requested, no password or owner setup. An in-flight state and inline error are appropriate. Never add a local control or settings button to the public UI.
- Treat every name/label/note as text; hostile strings and invalid stored JSON must not break the page. Safe output is essential because publishing is public.

## Delivery and verification

Integrate this folder as a self-contained `cloud/` directory (or another clear directory) in EOSguise on a feature branch. Preserve the real Firebase IDs and DNS. Keep secrets out of Git. Do not create another project or replace the user's other Stage Wiki sites. No GitHub workflow that requires a long-lived Firebase token; manual CLI deploy is sufficient for now.

Run existing mock tests: `node tests/test-network.mjs`, `node tests/test-sharing.mjs`, `node tests/test-eosguise.mjs`, `node tests/test-disguise-live.mjs`; root `test-active-cue.mjs`, `test-cue-status.mjs`, `test-cue-catalogue.mjs`, `test-cue-reconnect.mjs`, `test-cue-follow.mjs`, `test-cue-times.mjs`, `test-eos-picker.mjs`, `test-eos-picker-api.mjs`. Do not contact real show hardware or send real commands for testing.

Add meaningful publisher/rules/UI tests for: disabled config migration; canonical name collisions and forbidden raw key characters; point cues; reconnect preserves catalogue; latest state coalescing; timeout/backoff; no network blocking of local control; disable/rename during in-flight requests; offline settings save; malformed/oversized telemetry; two independent shows; same-name last-writer behavior; index/detail live updates; public delete removes both records; next activity restores full detail/catalogue; stopped show remains deleted; XSS text; stale/offline timestamps and browser disconnection; direct-link reload; every existing local control path absent from the hosted app.

Use emulators or disposable mocks for application testing. The infrastructure was already tested live using temporary setup records and those records were removed. Review `verification.json`; it does not prove the future dashboard/publisher works.

Deliver a reviewable PR with the runtime changes, real dashboard, updated setup docs and test results. Do not deploy an unfinished dashboard over the holding page. Final acceptance: operator enables publishing with just a show name, phone sees live status, Delete works, new activity re-adds complete data, and cloud failures do not affect the local show.

## References

- EOSguise: https://github.com/ProductionVideo/EOSguise
- Firebase REST: https://firebase.google.com/docs/database/rest/start
- Public REST access/rules: https://firebase.google.com/docs/database/rest/auth
- Atomic REST updates: https://firebase.google.com/docs/database/rest/save-data
- SDK listeners: https://firebase.google.com/docs/database/web/read-and-write
- Custom domain/TLS: https://firebase.google.com/docs/hosting/custom-domain
- Spark quota/billing: https://firebase.google.com/docs/database/usage/billing

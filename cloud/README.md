# cuedo website (cues.stage.wiki)

Public, read-only dashboard for status published by cuedo, plus the Firebase configuration it is deployed with. The infrastructure brief is in `CLAUDE-HANDOFF.md`; provisioning state is in `SETUP-STATUS.md` and `verification.json`.

```
Eos + Disguise <-> cuedo runtime on the show LAN
                       |  outbound HTTPS PATCH (cloud-publisher.mjs)
                       v
             Firebase Realtime Database (stagewiki-cues, europe-west1)
                       |  public reads (SDK WebSocket) and Delete (REST)
                       v
             Browser on Firebase Hosting (cloud/public)
```

## Layout

- `public/`: the deployed site. Buildless static HTML, CSS and ES modules.
  - `js/app.js`: routing (`/`, `/show/<showId>`), rendering. Every published value is rendered as text, never as HTML.
  - `js/data.js`: Firebase SDK listeners (pinned 11.10.0 from www.gstatic.com) and the REST URL used by Delete.
  - `js/model.js`: validation of untrusted database values, freshness and formatting.
  - `js/identity.js`: show-name to ID logic, byte-identical to `../cloud-identity.mjs` in the runtime.
  - `firebase-config.json`: the database address only. No API key is used or needed.
  - `install.sh`: the macOS/Linux one-line installer (`curl -fsSL https://cues.stage.wiki/install.sh | bash`). It downloads cuedo from GitHub and runs `scripts/install.sh`; it is not part of the dashboard.
- `database.rules.json`: the deployed v1 contract. Root read/write denied; `/shows/{id}` and `/showData/{id}` envelopes validated.
- `firebase.json`, `.firebaserc`: Hosting site `stagewiki-cues`, SPA rewrite, security headers and CSP.
- `tests/`: emulator end-to-end test, a local static server and a small headless Chrome driver.

Runtime side (repository root): `cloud-publisher.mjs`, `cloud-telemetry.mjs` (the explicit telemetry allowlist), `cloud-identity.mjs`, and the Settings section in `settings.html` / `settings.js`.

## Data contract

The contract is unchanged from the handoff:
- Each show has `/shows/{showId}` (small summary) and `/showData/{showId}` (`stateJson`, `cuesJson`, `catalogueHash`).
- `showId` is the SHA-256 of the NFKC-normalised, whitespace-collapsed, lower-cased name.
- **Full publish:** one atomic root PATCH writes both records.
- **Heartbeat:** the summary plus `showData/{id}/updatedAt` and `stateJson` only.
- **Delete:** one atomic root PATCH setting both records to null.

Publisher behaviour (cuedo):
- **Rate:** state changes are coalesced to at most one request a second, with a heartbeat every 10 seconds. Track timers ride along with heartbeats rather than triggering their own updates.
- **Requests:** one request in flight at a time, a 5-second timeout, and backoff with jitter capped at 60 seconds.
- **After a Delete:** a rejected heartbeat is retried once as a full snapshot, so the next activity restores the show with its complete catalogue.
- **Catalogue check:** every 60 seconds the publisher reads its own 64-character `catalogueHash` and compares it with what it last sent. This catches a catalogue replaced by another machine using the same name; the value is compared and never used otherwise.
- **Response bodies** are never read except for that hash.

Dashboard behaviour:
- **Listeners:** one summary listener per page. A show page adds separate listeners for `updatedAt`, `stateJson` and `cuesJson`, so heartbeats never re-deliver the catalogue.
- **Freshness:** fresh up to 30 s, stale up to 120 s, offline after that. Ages use the SDK's `.info/serverTimeOffset` and advance on a 1 s timer.
- **Timing display:** times advance at most 12 s past the last update, and only while the data is fresh, playing and the browser is connected. Otherwise they freeze and are labelled.
- **Delete** uses REST, so the listing only changes after the server confirms. A failed Delete keeps the listing and offers a retry.

The SDK replaced REST streaming because the database serves HTTP/1.1. A browser allows only 6 HTTP/1.1 connections per host, so a few open tabs would exhaust them; the SDK uses one WebSocket per tab. The emulator test opens 8 tabs at once to cover this.

## Security model and limits

- **No ownership:** the show name is the only identifier. Anyone can read a show whose name or link they know, overwrite it by publishing the same name, or delete it. This is by design (no accounts or keys) and is stated in cuedo Settings.
- **Spoofed names:** anyone can write a record by hand, so a listing's name might not match its ID. The dashboard checks that each name hashes to its ID and marks mismatches "Name does not match link".
- **Quota abuse:** the rules bound record sizes but cannot rate-limit writes. Someone could fill the Spark plan's storage or download quota by writing many large records, or delete every listing repeatedly. Firebase disables the database on Spark when a quota runs out, which affects the website only; shows keep running locally. If abuse happens, the usual options are Firebase App Check or authenticated publishing. Both need design work and possibly the Blaze plan.
- **One-way boundary:** nothing on the website can reach cuedo. There is no command path, the rules deny everything outside `/shows` and `/showData`, and cuedo ignores responses apart from the hash check.

## Test

Mock tests, no emulator needed (from the repository root):

```sh
node tests/test-cloud-identity.mjs
node tests/test-cloud-telemetry.mjs
node tests/test-cloud-publisher.mjs
node tests/test-cloud-settings.mjs
node tests/test-cloud-site.mjs
```

End-to-end test with the real rules, publisher and dashboard. It needs the Firebase CLI, Java 21+ and Chrome (`CHROME_PATH` if it isn't in a standard place), plus internet access to load the pinned SDK from gstatic. Run from `cloud/`:

```sh
firebase emulators:exec --only database --project stagewiki-cues "node tests/test-emulator.mjs"
```

To look at the site locally against a running emulator, run `firebase emulators:start --only database` and then `node tests/serve.mjs 5050`. Open http://127.0.0.1:5050.

## Deploy

Requires the Firebase CLI signed into an account with access to `stagewiki-cues`. Review rule changes first, and never deploy open root rules. Stay on the Spark plan unless you choose otherwise.

```sh
cd cloud
firebase deploy --only hosting --project stagewiki-cues            # website only
firebase deploy --only database --project stagewiki-cues           # rules only (unchanged from the deployed v1)
```

The show machine needs no Firebase CLI, login, key or certificate. cuedo uses the public REST endpoint built into `cloud-publisher.mjs`. The `CUEDO_CLOUD_DATABASE_URL` environment variable exists only to point tests at a mock or emulator.

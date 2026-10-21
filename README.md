# cuedo

Formerly EOSguise.

Standalone Windows utility for Eos cue feedback/control and Disguise transport feedback/control.

## Run

1. Download **Code > Download ZIP** from this repository and extract it to a permanent writable folder.
2. Run **Setup-Runtime.cmd** once to download a checksum-verified Node runtime from nodejs.org. Then run **Start.cmd**, followed by **Open.cmd**. Settings: http://127.0.0.1:38304/settings.
3. Set the Director address, refresh transports and choose one. Set Eos host, OSC TCP port, two displayed cue lists and the list to control. Save.
4. Optional: Install-Startup.cmd starts cuedo at Windows login. Stop.cmd stops both the app and its supervisor. Remove cuedo.lnk from shell:startup to disable automatic startup. Running Install-Startup.cmd again replaces an EOSguise.lnk shortcut from before the rename.

Windows x64 with Windows PowerShell 5.1 is required. Setup-Runtime.cmd installs a private Node v22.23.1 runtime. ws 8.22.0 is included with its licence. An existing Node 22+ installation on PATH can also be used. No Companion, Codex, npm installation or running chat is required. Keep runtime and vendor beside server.mjs. For another operating system, Node 22+ can run server.mjs directly; Windows launchers will not apply.

## Connections

- Eos must accept OSC 1.1 / SLIP TCP and allow OSC control. Enter the enabled console port. The default is 3032; use the port enabled in your console configuration.
- Designer must expose the Session HTTP API and Live Update WebSocket. Feedback was verified read-only with r32.4.18. Disguise control uses HTTP API commands, not an OSC device. No periodic Python execute requests.
- cuedo shares on all network adapters by default. In Settings, untick Share beside an adapter to close its IPv4 and IPv6 listeners. Changes apply immediately and persist across restarts. Localhost is always available. Settings lists current laptop addresses with adapter names, refreshing every 10 seconds. New interfaces work without restarting. The web port is 38304; edit config.json and restart to change it. Network reachability still depends on routing and Windows Firewall. IPv6 link-local addresses are shown as text because browsers cannot reliably use scoped URLs.
- Network clients can use the controls and settings. Use only on your trusted show network; this version has no login.

## Operation

Overview shows both cue lists with search and auto-follow. Eos opens a keypad for Go to Cue on the configured control list, including point cues such as 0.3. Sending does not confirm that the console actually executed a cue.

The current cue updates as soon as its fade starts. Auto-follow keeps it visible while enabled; untick it to browse freely. Cue lists remain available during catalogue refreshes and reconnects to the same console.

On the Eos keypad, type a cue number and press Enter or Go to cue. Backspace edits and Escape clears. A successful send clears the entry; an unsuccessful send keeps it for correction. Missing cues show an error and are not sent. On first connection, wait for the cue catalogue to load before sending.

Disguise controls and feedback follow the chosen transport. Fade up/down is Director-wide. Previous, Next and Previous End preserve playmode; Previous End targets one second before the current section begins, clamped to the previous section start.

Disguise feedback uses one shared Live Update subscription connection, with reconnect and ping/pong health checks. Eos uses its OSC subscription/bank feedback. Browsers refresh the local cached state once a second. Cue catalogue queries run on connection and cue-change notifications.

The first start copies config.example.json to config.json. Your settings are stored in config.json and excluded from Git. Stale pages cannot send commands after a settings change until they refresh their state. Commands are logged in web-eos-actions.jsonl and web-disguise-actions.jsonl. Process diagnostics are in server.log and error.log. Start.cmd is idempotent and Run.ps1 restarts the backend after an unexpected exit.

## Public status website (optional)

cuedo can publish read-only status to https://cues.stage.wiki so a phone or another computer can follow the show from anywhere. It is off by default.

1. In Settings > Public status website, tick **Publish status online**, enter a show name and press **Save publishing**. Nothing else is needed: no account, key, certificate, port forwarding or pairing.
2. The status line shows Off, Starting, Connected to cloud or Retrying, the last successful update and any error. The link opens the show's page.

What is published: the show name, connection state, the configured cue lists' names, current and next cue (number, label, notes), the cue catalogue (numbers, labels, fade times), and the selected Disguise transport's name, track, section, cue, playmode, engaged, output and timing. Nothing else: no addresses, hostnames, Director URL, transport UID, config, logs or diagnostics. cuedo only sends outbound HTTPS updates; the website cannot send commands, change settings or reach this computer.

The show name is the only identifier and is not a secret. Anyone who knows it can view the show, and anyone can delete the listing from the website (the next update from a running cuedo restores it within about 10 seconds; turn publishing off to remove it for good). Use a distinct name: two machines using the same name overwrite each other. Changing the name publishes a new listing; delete the old one from the website.

Updates are coalesced to at most one per second, with a heartbeat every 10 seconds and backoff when the cloud is unreachable. Cloud problems never affect local pages, controls or hardware connections. The website and its deployment are in cloud/; see cloud/README.md.

## Validation

Mock integration checks cover selected transport targeting, point cues, alternate cue lists, settings persistence, stale command rejection, idle heartbeat, reconnect, subscription cleanup and preserved navigation playmode. Real-show checks were read-only; no cues, transport changes or fades were triggered for testing.

Protocol reference: https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/Using_OSC_with_Eos/OSC_Eos_Control.htm

Third-party notices are in runtime/LICENSE and vendor/ws/LICENSE. 



## Tests

With Node 22+, run `node tests/test-network.mjs`, `node tests/test-sharing.mjs`, and `node tests/test-cuedo.mjs`. These tests use local mock endpoints; no real show hardware is contacted.

Cue regressions: `node test-active-cue.mjs`, `node test-cue-status.mjs`, `node test-cue-catalogue.mjs`, `node test-cue-reconnect.mjs`, `node test-cue-follow.mjs`, `node test-eos-picker.mjs`, and `node test-eos-picker-api.mjs`.

Public status: `node tests/test-cloud-identity.mjs`, `node tests/test-cloud-telemetry.mjs`, `node tests/test-cloud-publisher.mjs`, `node tests/test-cloud-settings.mjs` and `node tests/test-cloud-site.mjs` use mocks only. The end-to-end rules and dashboard test needs the Firebase emulator; see cloud/README.md.


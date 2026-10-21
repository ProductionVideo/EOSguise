# Setup status

Checked 21 October 2026, 21:34 BST.

- Created dedicated Firebase project `stagewiki-cues` (number `414602027201`), Hosting site, web app and default Realtime Database in `europe-west1`. No billing account was linked.
- Deployed holding page: https://stagewiki-cues.web.app (HTTP 200, CSP and other headers verified). This is not the real dashboard yet.
- Deployed bounded public telemetry rules. All 18 checks in verification.json passed; all disposable test records were removed. No real show hardware was contacted.
- Registered `cues.stage.wiki` as the custom domain on that Hosting site.
- Saved Squarespace DNS: `cues CNAME stagewiki-cues.web.app` (4-hour TTL). Verified publicly through Google and Cloudflare DNS. Existing apex, beta and email records were left intact.
- Saved Firebase-requested certificate validation TXT: `_acme-challenge.cues TXT vrqD889pM6JhPw5EDD3zVO43EKEGthdxnXalOwcK-MQ` (4-hour TTL). Verified saved in Squarespace.
- Firebase latest domain state: `HOST_ACTIVE`, ownership `OWNERSHIP_ACTIVE`, certificate `CERT_VALIDATING`. Raw public provisioning state is in domain-status.json.

## Remaining infrastructure state

Firebase reports domain ownership and hosting ACTIVE. TLS certificate provisioning is still pending at this check. The CNAME and certificate TXT are in place and public DNS resolves. Do not treat a certificate warning or Firebase Site Not Found page as application failure while this is pending, and do not bypass certificate checks. Firebase documents that provisioning can take up to 24 hours after DNS is correct: https://firebase.google.com/docs/hosting/custom-domain.

Use the working default Hosting URL during provisioning. Recheck the custom domain in Firebase Console > Hosting > stagewiki-cues and normal HTTPS. If validation requests a different TXT value, use the current value shown by Firebase rather than an old challenge. No certificates or keys need installing on show machines.

## Coding status

Implemented on the repository branch `feature/cloud-publisher`: the runtime publisher, the Settings section and the real dashboard in `public/`. All of it was tested against the database emulator with the deployed rules. The dashboard has **not** been deployed; the holding page is still live until the pull request is reviewed. See README.md for tests and deployment.

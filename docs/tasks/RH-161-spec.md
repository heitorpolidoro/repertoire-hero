# RH-161 — Launch the TWA on Google Play and record device evidence

Part 2 of the RH-81 split. Builds on `docs/tasks/RH-160-spec.md` (placeholders, `public/.well-known/assetlinks.json`, `android/twa-manifest.json`, `android/README.md`, `android/listing.md`, the `twa*` tests).

## Scope
Replace the RH-160 placeholders with real values, ship a signed build through the Play internal testing track, complete the store listing, and record device evidence in `android/evidence/launch.md` plus screenshots.

Not covered: production-track rollout, Play Billing, any change to the app's runtime code, service worker or `src/app/manifest.ts`, committing keystores or `.aab`/`.apk` files. No UI is built, so there is no mock.

## Who does what
Most of this task cannot be done by an agent: it needs the Play Console account, the signing keystore and a physical Android device.

**Operator-only**
- Create the app in Play Console with package id `app.repertoirehero.twa` (confirmed; the earlier "repertoireher" was a typo). The id is permanent after the first upload.
- Confirm the host (proposed `repertoire-hero.vercel.app`; a custom domain changes `host` and every URL below). The host can be changed after launch, but at a cost: the host is baked into each TWA build, so a change needs a new build and upload, `assetlinks.json` served from the new host, the privacy URL and listing updated, and the Spotify redirect URI re-registered. Builds already installed keep the old host until users update, so the old host must keep serving a valid `assetlinks.json` meanwhile. The package id stays permanent. Spec assumes the Vercel host for this task; if a custom domain is planned within months, decide before the first upload (internal testing makes a switch cheap now).
- Generate the upload keystore at the ignored `signingKey.path`, run `bubblewrap build`, upload the `.aab`, enable Play App Signing.
- Read the SHA-256 fingerprint from Play Console, App integrity, App signing key certificate. This is the one that must be in assetlinks, because Play re-signs the build. The upload-key fingerprint may be added as a second entry only if a locally installed build is also tested.
- Install from the internal testing track on a device, capture screenshots, run the offline path, and fill in the listing, content rating, data-safety and target-audience forms.

**Agent-doable** (before and after the operator steps)
- Create `android/evidence/launch.md` as a template with unticked items and `PENDING` slots. The template must not contain the word `PLACEHOLDER`, so the grep in ER1 can pass.
- Add a test, `src/lib/__tests__/twaLaunchEvidence.test.ts`, that checks `launch.md` (see Test criteria).
- Once the operator supplies values, apply them in `assetlinks.json`, `twa-manifest.json`, `README.md`, `listing.md`, and drop the word `PLACEHOLDER` from them.
- After deploy, run `curl -i https://<host>/.well-known/assetlinks.json` and paste the output into `launch.md`.
- Bump the `package.json` version per AGENTS.md.

## Approach

### Behavior
- `public/.well-known/assetlinks.json` carries the real Play app-signing fingerprint, not the all-zero value. `twa-manifest.json` `packageId` and `host` are confirmed values. `android/README.md` and `android/listing.md` no longer say `PLACEHOLDER`.
- `twaAssetLinks.test.ts` gains an assertion that no fingerprint is all zeros. The existing structural assertions stay.
- `android/evidence/launch.md` has these sections:
  1. **Asset links**: the pasted `curl -i` output, which must show the status line `HTTP/2 200` (the one accepted form; `HTTP/1.1 200` is not accepted) and `content-type: application/json`.
  2. **Install**: device model, Android version, install source (Play internal testing), and the screenshot link showing the TWA with no address bar.
  3. **Offline path**: steps in order (download a playlist, airplane mode, force-stop, reopen, setlist renders, tablature PDF renders) and a screenshot or recording link.
  4. **Spotify sign-in**: a required line `Spotify sign-in: returned to TWA, signed-in dashboard shown` plus a relative link to a screenshot of the signed-in dashboard inside the TWA. A Custom Tab bar while Spotify's origin is shown is expected.
  5. **Listing checklist**: eleven `- [x]` items, one per line, each starting with its label: Icon, Feature graphic, Phone screenshots (at least 2), Short description, Full description, Category, Contact email, Privacy URL (`https://<host>/privacy`), Content rating, Data safety, Target audience.
  6. **Pre-launch report**: one line of the form `Pre-launch report: 0 policy blockers, 0 crashes`.
- Screenshots and recordings live in `android/evidence/`, referenced from `launch.md` with relative links.

### Files touched
- `public/.well-known/assetlinks.json`: real fingerprint.
- `android/twa-manifest.json`: confirmed package id and host (only if the host changes).
- `android/README.md`, `android/listing.md`: placeholder wording removed, real values recorded.
- `android/evidence/launch.md` and image files: new.
- `src/lib/__tests__/twaAssetLinks.test.ts`: all-zero rejection.
- `src/lib/__tests__/twaLaunchEvidence.test.ts`: new.
- `package.json`: version bump.

### How the operator-only evidence is verified
- Asset links is verifiable by anyone: re-run the `curl` against the production host, and compare the served fingerprint with the file in the repo and with the Play Console value.
- Device and Console claims cannot be re-run by an agent. They are verified by artifacts: referenced image files must exist, be non-empty, and be readable by a reviewer, who looks at them for the no-address-bar state and the offline render. The Play Console fingerprint is cross-checked against the one in assetlinks.
- If the fingerprint is wrong, the device shows an address bar in the TWA. That symptom is itself the check for ER3.

### Test criteria
- `twaLaunchEvidence.test.ts` reads `android/evidence/launch.md` and asserts: it contains the status line `HTTP/2 200` (`HTTP/1.1 200` alone fails) and `content-type: application/json`; every image or recording link resolves to an existing non-empty file under `android/evidence/`; each of the eleven named listing items is present and ticked `- [x]` (deleting an item fails); there are no unticked `- [ ]` items; the Pre-launch line matches `0 policy blockers, 0 crashes`; the Spotify sign-in section contains the line `Spotify sign-in: returned to TWA, signed-in dashboard shown` and at least one screenshot link resolving to an existing non-empty file.
- The test is expected to fail until the operator evidence exists, so it ships in the same change as the completed `launch.md`, not before it.
- `twaAssetLinks`, `twaManifestParity`, `twaListing` and `twaRepoHygiene` stay green. `npm run lint` is clean.

## Expected Results
- [ ] ER1 — `grep -rn PLACEHOLDER public/.well-known android` returns no match.
- [ ] ER2 — `twaAssetLinks.test.ts` passes, including the assertion that no fingerprint in `assetlinks.json` is all zeros.
- [ ] ER3 — `android/evidence/launch.md` contains `curl -i https://<host>/.well-known/assetlinks.json` output whose status line is `HTTP/2 200`.
- [ ] ER4 — `android/evidence/` holds a screenshot of the installed TWA with no address bar, linked from `launch.md`.
- [ ] ER5 — `android/evidence/` holds a screenshot or recording of the offline path (download playlist, airplane mode, force-stop, reopen, setlist and tablature PDF render), linked from `launch.md`.
- [ ] ER6 — `twaLaunchEvidence.test.ts` passes, asserting each of the eleven named listing items is present and ticked in `launch.md`.
- [ ] ER7 — `launch.md` contains the line `Pre-launch report: 0 policy blockers, 0 crashes`.
- [ ] ER8 — The Spotify sign-in section of `launch.md` has the line `Spotify sign-in: returned to TWA, signed-in dashboard shown` and a link to an existing non-empty screenshot.

## Out of Scope
Production rollout, fixes to the app found during testing (new tasks), a custom domain migration beyond updating `host`.

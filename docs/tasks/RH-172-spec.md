# RH-172 — Check the Fast View row Stage button offline in production

Verification-only task: no code change, no UI, no mock. It runs after RH-148 (per-row `Stage` button in Fast View, see `docs/tasks/RH-148-spec.md`) is released to production. The service worker only runs over HTTPS, so the offline path cannot be checked in dev or CI.

Operator procedure (real phone, production URL):
1. Confirm RH-148 is deployed (each file row in Fast View shows a `⛶ Stage` button before the open-in-new-tab link).
2. Online, open a song's Fast View that has at least two PDF files, and let it load fully. Make sure the song is cached for offline (use the app's offline/cache action if it is not cached automatically) and wait for the cached indicator.
3. Open the viewer for the song's files once online so the PDFs are fetched and cached by the service worker. Then fully close the tab or app.
4. Turn on airplane mode (or disable Wi-Fi and mobile data). Confirm the app shows its offline state.
5. Reopen the app to the same song's Fast View. Without tapping the file title first, tap the `Stage` button on a row, then repeat on a different row (one that is not the currently viewed file).
6. Expected: each single tap opens Stage Mode for that row's file (the PDF renders), with no network error. Delete and star stay disabled offline.
7. Report pass or fail, plus the phone model and browser. On failure, note which row, what was shown (blank, error, nothing), and whether the song was confirmed cached.

Files touched: none. Test criteria: the operator result above; nothing is automated.

## Expected Results
See the `EXPECTED_RESULTS` block returned with this spec.

## Out of Scope
Any fix to a failure found (a failure becomes a new task), the online check (already passed), automated offline tests.

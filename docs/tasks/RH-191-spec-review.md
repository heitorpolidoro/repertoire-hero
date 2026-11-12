VERDICT: APPROVED

Review mode: round 3 (findings-only). Inputs: the task from the Meridian API, `docs/tasks/RH-191-spec.md`,
`docs/tasks/RH-191-mock.html`, the round 2 report, `src/hooks/useOfflinePlaylist.ts` and
`src/components/fastview/SetlistSelect.tsx`.

## Blocking Findings

None.

## Previous findings

1. **Failure copy and M (rules 9 and 10): resolved.**
   - Rule 10 now starts from "Every run starts by reading the playlist itself", which matches
     `useOfflinePlaylist.ts` L198. It splits a failed read into two cases.
   - Already downloaded: exact copy `Could not reach this playlist. Your offline copy was not changed.`, with
     "Try again". The stored list, songs and bytes stay, the control stays downloaded, and this holds for
     refresh, retry and missing-songs runs.
   - Not downloaded: no list, songs stored on their own stay, the control goes idle, and the alert is
     `Could not download this playlist. Nothing from this playlist was kept.`
   - Rule 9 defines M as the number of songs the run tried to fetch, with the `1 of 2` example, and keeps the
     control's count against the whole setlist.
   - The alert-copy test criterion names all three cases and asserts the untouched list, songs and bytes at
     store and hook level.
   - The mock shows `1 of 2` and the already-downloaded read failure (section 3, L104-117). The not-downloaded
     read failure uses the copy already at L80. The mock's script computes M from the songs attempted (L447,
     L455).

2. **Mock missing the select state (rule 32): resolved.** Mock section 4 (L155-170) shows the select closed,
   following the simulated device, and opened as a static list. The opened list has the disabled option
   `3. Pais e Filhos (not on this device)` and options keeping `<n>. <title> - <artist>`, so the dropped suffix
   is visible. Rule 32 now states both labels and points at the mock. The new script code reaches elements
   through `document.getElementById` (`el()`), so there is no bare-id global.

3. **Expected result 1 out of shape: resolved.** The line in the task and in the spec is now one assertion:
   one song record with one set of cached bytes per version and owner context, in two named tests in
   `offlineStore.test.ts`. Both operator results keep their meaning: one record for two setlists sharing a song
   in one context, and two records for personal plus band, since those are two owner contexts. The spec's
   Operator Results Coverage section says so, and the Test criteria keep both scenarios with their outcomes.

## Consistency pass on the changed sections

- Rules 9 and 10 do not conflict. Rule 9's "at least one song on the device keeps the list" needs a playlist
  read that succeeded, and rule 10 explicitly decides the failed read on a setlist that is not downloaded.
- The API's `expected_results` match the spec's Expected Results line for line, and there are eight.
- All eight operator results are still covered.

## Suggestions

- **"Try again" after a failed refresh does not refresh.** Rule 7 makes "Try again" fetch only missing songs,
  and rule 10 now offers it after a failed read on "Refresh offline copy". The same applies to a refresh where
  some songs failed: rule 3 keeps their earlier copies, so they are not missing and are not fetched again. On a
  `5 of 5` setlist the retry fetches nothing and clears the alert. The behaviour is defined, so it does not
  block, but "Try again repeats the run that failed" is probably what the user expects. If that is adopted, it
  needs a test.
- **Mixed message on a read failure with songs stored.** On a setlist that is not downloaded, the idle hint
  `2 of 5 songs are already on this device.` can sit above `Nothing from this playlist was kept.` Rule 10 could
  use a different second sentence when songs remain.
- **Name the select's text in the tests.** The test criterion "a disabled row and option" does not name rule
  32's exact option text.
- **Expected result 2 is long.** It now checks the row mark, the count and the refresh. It was not named by the
  previous findings and each check is decidable, so it stays as a suggestion.
- **Carried from round 2, still open:**
  - Rule 12 (offline screen, exact owner context) and rule 32 (chrome, any context through rule 22) can disagree
    for a song stored only in another context. A sentence saying this is intended would prevent a debate in code
    review.
  - Rule 35's "Only a `200`" does not exclude a followed redirect. `fetch` follows a proxy redirect to `/login`
    and reports `200`, which would store the login page under the song's address. Require
    `response.redirected === false` or `redirect: 'manual'`, and cover it in the store test.
  - Rule 6 does not name the setlist's name and owner context as stored, though rules 12, 20 and 31 read them.
  - The interactive alert in mock section 1 has no dismiss button, while rule 17 and the static examples do.

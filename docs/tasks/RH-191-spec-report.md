# RH-191 — spec generator report, round 3

## Operator answers
Both were already reflected in the spec from the previous round and are kept:
- Removing a setlist: **Delete** (rule 18) — its songs are deleted except those held by another downloaded setlist in the same owner context or downloaded individually.
- Removing one song: **B** (rule 17) — a mark and a trash button on every song row, not a list in the offline box. Mock section 2 records both decisions.

## Findings addressed

1. **Rules 9/10 ambiguity (failed playlist read, M undefined).**
   - Rule 9 now defines **M as the number of songs this run tried to fetch**, not the setlist size. Example in the spec: a "Try again"/"Download 2 missing songs" run fetching 2 of a 5-song setlist with 1 failure reads `1 of 2 songs could not be downloaded.`; the control count still reads against the whole setlist.
   - Rule 10 now opens with "every run starts by reading the playlist itself" and splits a failed read:
     - setlist already downloaded: nothing on the device changes (list, songs, bytes), control stays downloaded with its count, alert `Could not reach this playlist. Your offline copy was not changed.` with "Try again" — for Refresh, Try again and Download N missing alike;
     - setlist not downloaded: no list kept, individually stored songs stay, idle, alert `Could not download this playlist. Nothing from this playlist was kept.`.
   - The alert-copy test criterion names all three cases (1 of 2, failed read on downloaded with store unchanged, failed read on not downloaded).
   - Grounded in `src/hooks/useOfflinePlaylist.ts` L198, where `getPlaylistDetailsWithEntries` is the first await of `download`.

2. **Mock missing the SetlistSelect state.** Mock section 4 now has "Fast View offline on a phone (below lg): the setlist select": a live closed select driven by the simulated device (disabled options for removed songs, change handler moves the walk), and a fixed opened `size=5` select with option 3 `3. Pais e Filhos (not on this device)` disabled and the others `<n>. <title> - Legião Urbana`. A caption states the dropped ` - <artist>` suffix. Rule 32 now says this explicitly, matching `SetlistSelect.tsx` L37's current label.
   - Also added two static alert examples to mock section 3 for the new rule 9/10 copy, and fixed the mock's live download to use M = attempted songs and to make Refresh re-fetch every song (rule 7).

3. **Expected result 1 out of shape.** Restated as one assertion: `offlineStore.test.ts` asserts exactly one song record, with one set of cached bytes, per version and owner context, in both a test named for two setlists sharing a song and one named for a version downloaded in personal and band context. Both operator results remain covered (coverage table unchanged; note below it rewritten).

## Files
- `docs/tasks/RH-191-spec.md` — rules 9, 10, 32; test criteria alert line; Expected Result 1; coverage note.
- `docs/tasks/RH-191-mock.html` — section 3 two static alerts; section 4 select block; script: select render/handler, M fix, refresh fetches all.
- Commit `918b500` on `meridian/RH-191`.

## Notes
- A JS syntax check of the mock via `node -e` was refused by the dispatch hook (shell substitution); the edited script was reviewed by reading it, and a dropped `function render() {` header was caught and restored.

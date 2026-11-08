# RH-192 — Spec Generator Report

## Summary of Work Done

1. **Context & Scope Identification**:
   - Analyzed parent task RH-191 ("Make offline a per-song option and setlist download a shortcut") and its 5-part decomposition (RH-192 to RH-196).
   - Positioned RH-192 as Part 1: the foundational data-layer refactor replacing the whole-package snapshot storage model with song-level persistence and ordered setlist lists.
   - Clarified explicit boundaries separating RH-192 from subsequent tasks:
     - RH-193 handles playlist page row marks, live header counts, and responsive layout.
     - RH-194 handles Settings storage UI redesign (Playlists vs Songs lists).
     - RH-195 handles `/offline` setlists listing and service worker document caching.
     - RH-196 handles Fast View offline availability checks and skip navigation.

2. **Data Model & Behavioral Contract**:
   - Defined song identity as `songRecordId(versionId, bandId)` with an `individualDownload: boolean` flag, stored once per version and owner context.
   - Defined setlist storage as an ordered list of `{ versionId, title, artist }` entries without duplicated song snapshots or duplicate blob caching.
   - Specified per-key byte deletion on `OfflineBlobPort` (`delete(key)`).
   - Specified the protection rule: removing a setlist deletes its list and deletes only songs that are not held by another downloaded setlist in the same owner context and not marked as individually downloaded.
   - Specified pure offline conversion (`src/lib/offlineConversion.ts`): converts existing v5/v6 stored records to song records and ordered setlist lists with no network access (asserted against a throwing `fetch`), deduplicating shared songs by freshest `savedAt` and cleaning up orphaned file bytes.
   - Specified offline-first reader fallback: `getResolvedEntryForVersion` prefers the requested owner context, falls back to any other stored owner context for that `versionId`, and answers `null` after removal.
   - Specified download failure isolation and precise alert copy for `useOfflinePlaylist`.

3. **Line Count & Architectural Guardrails**:
   - `src/lib/offlineStore.ts` currently has 316 lines and `src/lib/offlineSnapshot.ts` has 377 lines (both near the 400-line budget cap).
   - Isolated the conversion logic completely into a new pure module `src/lib/offlineConversion.ts` so `offlineStore.ts` remains comfortably within the 400-line limit.

4. **Interactive Mockup Created**:
   - Authoring `docs/tasks/RH-192-mock.html` with interactive switches for all download failure and alert states:
     - Partial download failure: `1 of 2 songs could not be downloaded.` with `Try again`.
     - Playlist unreachable on already downloaded setlist: `Could not reach this playlist. Your offline copy was not changed.`.
     - Quota failure: `Not enough storage. N of M songs could not be downloaded.`.
     - Total failure on initial download: `Could not download this playlist. Nothing from this playlist was kept.`.

5. **Behavior Registry Consistency**:
   - Evaluated `docs/behavior.md` area `Offline`.
   - Formulated 6 behavior changes (2 changed, 4 added) reflecting the transition to song-level offline persistence, protection rules, failure isolation, and pure offline conversion.

## Artifacts Produced

- Spec: `docs/tasks/RH-192-spec.md`
- Mockup: `docs/tasks/RH-192-mock.html`
- Report: `docs/tasks/RH-192-spec-report.md`

## Expected Results

EXPECTED_RESULTS:
offlineStore.test.ts asserts exactly one song record, with one set of cached bytes, per version and owner context, in both a test named for two setlists sharing a song and one named for a version downloaded in personal and band context.
Removing one stored song leaves every other song and every setlists list stored, in offlineStore.test.ts.
Removing a downloaded setlist deletes only the songs not held by another downloaded setlist and not downloaded individually, in offlineStore.test.ts.
offlineConversion.test.ts converts a stored v6 setlist and song: record with a throwing fetch, leaving one record per song whose files still answer offline.
When one song fails during a setlist download, useOfflinePlaylist.test.tsx shows the other songs stored, the count one short, and the alert offering Try again.
A failed playlist read on an already downloaded setlist leaves stored records and bytes unchanged and shows Could not reach this playlist. Your offline copy was not changed. in useOfflinePlaylist.test.tsx.
offlineFirst.test.ts asserts that getResolvedEntryForVersion prefers the requested owner context and falls back to any other stored context for that version, and answers null after removal.

MOCK_PATH: docs/tasks/RH-192-mock.html

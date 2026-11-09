# RH-194 — Spec Generator Report

## Summary of Work Done

1. **Architecture & Scope Analysis**:
   - Reviewed existing `/settings` offline implementation in `src/components/settings/OfflineStorageSection.tsx` and `src/hooks/useOfflineLibrary.ts`.
   - Reviewed parent task RH-191 and preceding split tasks RH-192 (song-level store, ordered setlist lists, protection rules for removals) and RH-193 (playlist-level counts and row marks).
   - Addressed Part 3 requirements: separating `/settings` offline storage into two distinct lists (Playlists and Songs), deduplicating total storage so shared songs are counted once, and removing the legacy green "Song" badge.

2. **Design & Behavior Decisions**:
   - **Playlists List**:
     - Counts stored vs total songs (`N of M songs`) derived from the stored setlist list entries and currently stored song records (RH-191 rule 14, as Settings has no live playlist context).
     - Summed size reflects only the bytes of songs currently on the device for that playlist.
     - Formats download age at read time, preserving purity.
     - "Remove" action invokes `removeOfflinePlaylist`, adhering to the protection rule (deletes only songs not held by another downloaded playlist and not marked `individualDownload: true`).
   - **Songs List**:
     - Lists all stored song records by title.
     - Removes the "Song" badge (`<span className="...">Song</span>`).
     - Derives provenance: lists holding playlists (`In <playlistName>`) and/or `Downloaded individually`.
     - Formats individual byte size and download age at read time.
     - "Remove" action invokes `removeOfflineSong`, which deletes the song record and its cached files, while leaving all playlist lists stored and lowering their counts and summed sizes.
   - **Deduplicated Total Storage**:
     - Sums `bytes` of each unique stored song record once. If two downloaded playlists share a song, its bytes are counted once in `totalBytes`.
     - Secondary browser quota line is retained and omitted if `navigator.storage` is unavailable.
   - **Empty State**:
     - When neither playlists nor songs are stored, displays "Nothing is stored on this device." with total `0 B`.
     - When one section has items and the other is empty, renders only the populated section.

3. **Mockup Authored**:
   - Created standalone interactive mockup in `docs/tasks/RH-194-mock.html`.
   - Demonstrates the Settings card with deduplicated total storage (39.5 MB for 5 unique songs across 2 playlists + 1 individual song).
   - Includes interactive "Remove" on playlists (demonstrating protection rule keeping shared/individual songs) and "Remove" on songs (demonstrating count reduction on holding playlists).
   - Includes a "Reset Mock Data" button and an event log explaining each interaction.

4. **Behavior Registry**:
   - Updated line under `Offline`:
     `changed: Offline — Settings lists the downloaded playlists with their song counts and the stored songs, lets the user remove either, and totals each song once. (src/components/settings/OfflineStorageSection.tsx, src/hooks/useOfflineLibrary.ts) (RH-194)`

5. **Expected Results Formulated**:
   - Formulated 6 checkable, single-sentence expected results satisfying all 4 starting results and covering badge removal and empty state.

## Artifacts Created

- Spec: `docs/tasks/RH-194-spec.md`
- Mockup: `docs/tasks/RH-194-mock.html`
- Report: `docs/tasks/RH-194-spec-report.md`

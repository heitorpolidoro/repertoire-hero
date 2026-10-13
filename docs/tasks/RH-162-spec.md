# RH-162 — Play uploaded audio in Fast View with an audio player

## Scope

Part 1 of the RH-149 split. A musician uploads an audio file (backing or reference track) against a catalog song and plays it from Fast View with the browser's native audio element. This spec settles the four questions RH-149 left open; each is a decision, not an option.

**Decisions**

1. **Ownership: uploader-only, no new model.** Audio is a `song_files` row like a PDF: keyed `(user_id, song_id)`, no `band_id` (RH-123, "a file belongs to the person"). Uploading in band context lands on the uploader's own row and ensures their repertoire row, exactly as `uploadTabAction` does today. Bandmates do not see or hear it. Sharing audio with a band is a future task and would need a model of its own.
2. **Formats: MP3 and M4A (AAC) only**, stored byte-for-byte (no transcoding). The type is decided by sniffing leading bytes (ID3 tag or MPEG frame sync for MP3; `ftyp` box at offset 4 for M4A), never by `file.type` (RH-127 rule). WAV (size), OGG/Opus (no Safari parity) and video containers are refused. `song_files.content_type` stores `audio/mpeg` or `audio/mp4`.
3. **Size and quota.** Per-file cap 10 MB (the same cap as tabs, and inside the 12 MB `serverActions.bodySizeLimit` in `next.config.ts`; about ten minutes of 128 kbps MP3). Per-user quota 100 MB of audio in total, counted from a new nullable `song_files.size_bytes` column written for audio rows. An upload that would take the total past the quota is refused. Deleting a file frees its share. Vercel Blob cost is bounded by quota times users; no sweeper is added (the `abandoned_blobs` ledger still applies on a failed object delete). Known risk, not solved here: Vercel's platform limit on function request bodies is below 10 MB; if production uploads near the cap fail, a follow-up moves audio to client-direct Blob upload.
4. **Offline: audio is not in the downloaded snapshot.** Snapshots stay PDF/image only (storage budget: a 20-song setlist of 10 MB tracks would add up to 200 MB with no eviction policy, and the Cache Storage tab cache has none). Offline, Fast View still lists the song's audio files but renders an explicit "Audio is not available offline" state in place of the player; it never renders a player that cannot load. Online, the player is shown. Downloading audio is a possible follow-up.
5. **Player behaviour.** A native `<audio controls preload="none">` per file: play/pause, seek, time, volume come from the browser. No `autoplay` attribute and no scripted `play()` on mount, route change or song change; playback starts only on the user's tap. Fast View is one route per song, so navigating to another song unmounts the element and stops playback. The existing `useWakeLock` already keeps the screen on while Fast View is mounted; nothing changes there. This element is **not** built as the base for the practice transport (RH-149 panel D) or the setlist player (panel F): a player that survives route changes needs hoisting above the route, and loop/slow/count-in need their own controls. Those tasks may reuse the lib and the stored rows, not this component.

Not in scope: sharing audio in a band, offline audio, transcoding or trimming, waveform/loop/tempo controls, a setlist player, streaming from Spotify/YouTube, any change to the PDF/image upload path's behaviour.

## Approach

Behavior
- Upload: a new audio upload action (separate from `uploadTabAction`, same auth, ensure-own-entry and Blob `put` shape) validates in this order, writing nothing before the last step: required fields; size over 10 MB -> 4xx-class error; sniffed type not MP3/M4A -> error naming the allowed types; quota check (sum of the user's audio `size_bytes` plus this file over 100 MB) -> error; then ensure-own-entry, `put` to `song-files/<userId>/<songId>/...`, insert the row with `content_type` and `size_bytes`. If the insert fails after `put`, the object is recorded in `abandoned_blobs`.
- "4xx" is expressed at the action boundary as the existing `{ error }` envelope; if an HTTP route is used instead, it answers 413 (cap, quota) and 415 (type).
- Existing tab readers and the PDF/image viewer must ignore audio rows (filter by content type), so an audio file never appears in the chart list or opens in `TabViewer`. The offline snapshot capture likewise skips audio rows.
- Fast View shows an audio section only when the reader has at least one audio file for the song, listing each with its title and a delete control (reusing the existing delete action, which already removes row then object).
- Offline (from `OfflineBanner`/offline state already available to Fast View): the section renders the not-available-offline message per file instead of the element.

Files touched
- `migrations/<next free number>_song_files_size_bytes.sql`: add nullable `size_bytes bigint` with a column comment.
- `src/lib/fileIngest.ts`: audio sniff + allowed audio types, caps, error messages (`UploadContentType` stays image/PDF; add a separate audio type).
- `src/lib/tabs.ts`: `createTab` accepts optional `sizeBytes`; new `sumAudioBytes(userId)`; chart-list reads exclude audio.
- `src/app/actions/audio.ts` (new): the upload action.
- `src/lib/offlineSnapshot.ts` / capture path: skip audio rows.
- `src/components/fastview/AudioSection.tsx` (new, presentational) and an upload control beside `TabUploadForm`; wired at the Fast View composition point, not added to `page.tsx` logic. i18n keys in `en.json` and `pt-BR.json`.
- `src/types/database.ts`, `src/lib/dbRows.ts`: `size_bytes` on the row type/projection.
- `docs/use-cases.md`, `AGENTS.md`: Song File entry gains audio, ownership, quota and the offline exclusion.

Test criteria
- DB test: upload stores a row with `user_id` = uploader, `content_type` `audio/mpeg`, `size_bytes` set; the same upload in band context also stores against the uploader and creates no band row.
- Action tests: 10 MB + 1 byte refused; quota overflow refused (seeded rows near 100 MB); WAV/OGG/PDF-renamed-`.mp3` refused; each refusal asserts no `song_files` row and no `put` call.
- Component tests: audio element rendered with no `autoplay` attribute and `play` not called on mount; offline renders the not-available state and no `<audio>`; online renders `<audio controls preload="none">`.
- Regression: chart list and offline capture exclude audio rows.

## Expected Results
- [ ] Uploading a valid MP3 stores one `song_files` row owned by the uploading musician with an audio `content_type` and `size_bytes`, asserted by a DB test (also in band context).
- [ ] A file over 10 MB, or one that would push the user's audio total past 100 MB, is rejected with an error and no row or Blob object is written, asserted by named tests.
- [ ] A file whose sniffed type is not MP3 or M4A (including a non-audio file renamed `.mp3`) is rejected at upload with an error and no row, asserted by a named test.
- [ ] Fast View renders `<audio controls preload="none">` without `autoplay` for a song with an audio file, and a component test asserts `play()` is never called before a tap.
- [ ] Offline, Fast View shows an explicit "Audio is not available offline" state and no audio element, and online it shows the player, one component test per state.
- [ ] Audio rows never appear in the PDF/image chart list or the offline snapshot, asserted by a test.

## Out of Scope
Band-shared audio, offline audio, transcoding, practice transport, setlist player, client-direct Blob upload, a blob sweeper.

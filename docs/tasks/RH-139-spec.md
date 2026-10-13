# RH-139 — Roll back the repertoire rows a failed Spotify sync leaves behind

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


> Spec file name is the board id + 1 (repo convention): this is RH-139's spec.
> (`docs/tasks/RH-138-spec.md` belongs to board task RH-138.)

## Scope
The pull direction of `POST /api/spotify/playlists/[id]/sync` seeds the owner's repertoire (`user_songs` / `band_songs`) once per resolved track, on the pool, before the transaction that rewrites `playlist_songs`. When that transaction fails, the playlist rows roll back but the repertoire rows stay committed. After this task the repertoire seeding and the playlist rewrite succeed or fail together.

Decision: move the seeding into the existing playlist transaction (not a compensating delete). A compensation would have to tell rows this sync created from rows the owner already held, and a failed compensation would leave the same residue; the transaction needs no such bookkeeping and matches `addSongToPlaylist`.

Not covered:
- The catalog rows (`songs`, `albums`, `song_versions`, `song_links`) written by `findOrCreateSong`. Each track's resolution is already its own atomic unit and the catalog has no delete path; they stay committed on failure, as designed.
- The import route (`.../import/route.ts`), which has a similar shape (seeding before the playlist insert) but creates the playlist in the same request; it is a separate decision, noted as a follow-up.
- The push direction, `ensureInRepertoire` itself, and any UI.

## Approach
Behavior:
- In the pull branch the track loop only resolves versions (`findOrCreateSong`) and collects their ids; it no longer calls `ensureInRepertoire`.
- Inside the existing `withTransaction` (after the `DELETE`, alongside the insert) the route calls `ensureInRepertoire(versionId, owner, client)` for each deduplicated resolved version, passing the transaction client (the helper already accepts a `Queryable`). A failure in either the seeding or the `playlist_songs` insert rolls back both.
- Owner semantics are unchanged: a band playlist seeds only `band_songs`, a personal one only the caller's `user_songs` (RH-126). A successful pull still seeds exactly the rows it did before, and the `{ added, removed }` response is unchanged.
- A retried failed sync must not accumulate holds: after a 500, `user_songs` / `band_songs` hold no row that the failed pull added.
- Seeding per deduplicated version (not per track) is fine: duplicates were absorbed by `ON CONFLICT DO NOTHING` anyway.

Files touched:
- `src/app/api/spotify/playlists/[id]/sync/route.ts`: drop the in-loop `ensureInRepertoire`; seed inside the transaction with the client; update the transaction comment to say it now covers repertoire seeding.
- `src/lib/__tests__/spotifySyncAtomicity.db.test.ts`: add the failing-insert repertoire assertion; update the header and `BAND_TRACK_*` comments that describe the old seam (the per-test distinct track may stay).
- `docs/use-cases.md` / `AGENTS.md`: only if either describes the old non-atomic seeding; otherwise untouched.

Test criteria (DB test, `RUN_DB_TESTS`): the existing failing-insert trigger test additionally asserts that, after the 500, the owner has no `user_songs` row for the pulled track's song (queried via `OWNER_SONG_FROM.user`, joined on the song created for that track). A band-playlist variant with the same trigger asserts no `band_songs` row. The existing success tests (personal and band seeding, no member fan-out) keep passing unchanged. To prove the test bites, it must fail against the pre-change route.

## Expected Results
- [ ] ER1: When the `playlist_songs` insert fails during a personal pull, the route answers `500` and the caller has no `user_songs` row for any version that pull resolved.
- [ ] ER2: When the `playlist_songs` insert fails during a band-playlist pull, the route answers `500` and the band has no `band_songs` row for any version that pull resolved.
- [ ] ER3: A successful personal pull still creates the caller's `user_songs` row for each pulled version, and returns the same `{ added, removed }` body as before.
- [ ] ER4: A successful band pull still creates one `band_songs` row and no `user_songs` row for any member (RH-126 invariant intact).
- [ ] ER5: In `sync/route.ts`, `ensureInRepertoire` is called only with the transaction client, inside the `withTransaction` callback, and not inside the track loop.
- [ ] ER6: The new failing-insert repertoire assertions in `spotifySyncAtomicity.db.test.ts` fail against the pre-change route and pass after it; the full suite and lint pass.

## Out of Scope
Import route atomicity; rolling back catalog rows; any schema change.

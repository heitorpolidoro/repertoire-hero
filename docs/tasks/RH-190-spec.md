# RH-190 — Show custom fields together with the song in Fast View

## Scope

**Covers.** Opening a song or moving through a setlist in Fast View shows the
reader's custom fields (RH-186) in the same paint as the song, because they travel
in the RH-134 song window instead of a second, later read.

**Does not cover.** How custom fields look or are edited; the offline snapshot's
shape; `GET /api/v1/songs/{versionId}`; any other Fast View section that loads late
(files, audio, the personal entry); noticing an edit made elsewhere (see Decided).

## Decided

- **The window stays a latency optimisation (RH-134).** With the window absent or
  failed, the fields load through `getCustomFieldValues` exactly as they do today.
- **A cached copy is not re-read in the background.** A value set through the API,
  or a definition changed in another tab, shows after a reload. This is the rule
  every other windowed field follows (RH-134's "someone else's edits"); until now
  custom fields refreshed on every remount, so this is a small, accepted loss.
- **The values stay the signed-in user's.** The window reads them with its `userId`,
  never its owner. `bandId` only addresses the client cache: no custom field read
  or write takes a band id.

## Approach

### Behavior

1. **The window carries the fields.** Each `SongWindowRecord` gains `customFields`:
   the same list `getCustomFieldValues` answers, loaded alongside the files. A
   version that does not exist answers `[]`. A failing custom field read fails the
   window like any other database error, and the per-song reads then take over.
2. **Read through the window, in the page.** `useSongCustomFields` waits for a window
   fetch already filling its song, then uses the cached copy; on a miss it calls the
   action. The hook must be called in the page, after `useSongWindow`, with
   `CustomFieldsSection` receiving its controller, as `LinksSection` does.
   This is load-bearing: a child's effects run before its parent's, so a hook left
   inside the section starts before the window fetch on every setlist move, sees no
   fetch to wait for, and sends the duplicate request this task removes. On a cold
   open it also mounts only after the entry, which is the waterfall itself.
3. **No empty render on a hit.** When the song on screen is cached, the hook answers
   its fields from the first render for that version, so the section never collapses
   and returns. On a miss it answers `[]` until loaded; the rule that one version's
   values never show on another stays.
4. **The cache is a seed, not the source.** Once applied, the fields live in the
   hook's state. Another write dropping the cached copy (a status change, say) must
   not empty the section, and a save on fields that came from the cache must still
   update the value on screen.
5. **A saved value invalidates its song.** A successful save or clear calls the
   page's existing `invalidateCurrent` seam through a hook callback, for the version
   the save was started on, even if the user has moved on. A failed save invalidates
   nothing.
6. **A definition change drops everything.** The cache survives client navigation, so
   going from Settings back to a song would otherwise show a deleted or renamed field from the
   old copy, and an Edit on a deleted one fails. Every successful create, rename, move
   and delete in `useCustomFieldSettings` calls a new function in `songWindow.ts` that
   empties the cache for all owners and makes every fetch in flight stale.
7. **Offline is unchanged.** `cachedSong` answers nothing offline, so the read falls
   through to the snapshot-backed action; the offline read-only rules stand.

### Files touched

- `src/lib/songWindow.ts` — `customFields` on the record; the drop-everything function.
- `src/lib/songWindowData.ts` — load `customFields` in `songWindowRecord`.
- `src/hooks/useSongCustomFields.ts` — `bandId` and an on-saved option; cache-first read and first-render seed; replace the docblock saying it is not part of the window.
- `src/hooks/useCustomFieldSettings.ts` — drop the window after each successful write.
- `src/components/fastview/CustomFieldsSection.tsx` — take the controller instead of owning it.
- `src/app/songs/[versionId]/fast-view/page.tsx` — call the hook after `useSongWindow`; pass the controller. No new state or effect (RH-38); no complexity override added.
- `AGENTS.md` — the song window and Custom Fields paragraphs, one line each.
- `docs/use-cases.md` — the "One request fetches a window" paragraph, one line.
- `docs/behavior.md` — the line under Behavior changes.
- Tests below, plus `customFields` on existing `SongWindowRecord` fixtures.

### Test criteria

- `src/app/songs/__tests__/fastViewPage.test.tsx`: `song and custom fields appear in the same render` (window held open, then released; the field is present as soon as the title is, with no further wait); `opening a song asks for custom fields only through the window`; `moving to a song outside the window sends one window request and no custom field read`.
- `src/hooks/__tests__/useSongCustomFields.test.tsx`: `a cached song answers its fields on the first render and calls no action`; `a miss falls back to the action`; `a failed window falls back to the action`; `dropping the cached copy keeps the fields on screen`; `saving a value that came from the cache updates it and calls on-saved`; `a save answered after the version changed reports the version it was made on`; `a failed save does not call on-saved`; `offline, the action answers and the cache is not read`. Existing tests stay.
- `src/hooks/__tests__/useCustomFieldSettings.test.tsx`: `each successful definition write drops the song window`; `a failed definition write does not`.
- `src/lib/__tests__/songWindow.test.ts`: `dropping everything empties all owners`; `in-flight fetch discarded after dropping everything`.
- `src/hooks/__tests__/useSongWindowInvalidation.test.tsx`: `edit a custom field, go to a neighbour and back shows the new value`.
- `src/lib/__tests__/songWindowData.db.test.ts`: `a record carries the caller's own custom fields in band context`; `a nonexistent version answers customFields []`.
- `src/components/fastview/__tests__/CustomFieldsSection.test.tsx`: existing cases, driven through the injected controller.

## Behavior changes

- changed: Fast View and queue — Content is fetched as a window of the current song and its neighbours, including the reader's own custom field values; a write invalidates that song's cached copy, and a custom field definition change drops every cached song. (RH-190)

## Expected Results

- [ ] `song and custom fields appear in the same render` passes: when the title first shows, the song's custom fields are already on screen.
- [ ] `opening a song asks for custom fields only through the window` passes: `getCustomFieldValues` is not called when the window answers.
- [ ] `a cached song answers its fields on the first render and calls no action` passes.
- [ ] `a failed window falls back to the action` passes: the fields still show when the window request fails.
- [ ] `a record carries the caller's own custom fields in band context` passes.
- [ ] `edit a custom field, go to a neighbour and back shows the new value` passes.
- [ ] `each successful definition write drops the song window` passes.
- [ ] `offline, the action answers and the cache is not read` passes.

## Out of Scope

A loading placeholder for the section, a cache lifetime or background refresh, and
moving any other Fast View read into the window. The mock (`docs/tasks/RH-190-mock.html`)
replays the timing only: the section's appearance does not change.

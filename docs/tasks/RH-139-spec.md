# RH-138 — Make a links correction act per link row, not per whole array

> Spec file name is the board id + 1 (repo convention): this is RH-138's spec.
> Mock: `docs/tasks/RH-139-mock.html` (three screens; the open question is on screen 3).
> The task text names `src/lib/songEditPayload.ts:98 parseLinks`; that file does not exist.
> `parseLinks` lives in `src/lib/catalogSuggestionPayload.ts` (RH-107). `src/lib/songs.ts:221-224`
> is now `applySongLinkUpdate`'s `pending` branch, around line 300.

## Scope

Today any non-additive links edit queues the **entire array** as one `('songs','links')`
suggestion, and approving it runs a replace-set over `song_links`. This task makes a
correction target one `song_links` row by its stable `id` (RH-136), end to end:

1. **Propose** — a correction names a link row and what changes on it: its `url`, its `label`,
   or its removal. An untouched row sends nothing.
2. **Store** — one `catalog_suggestions` row per (link id, changed thing), sharing the
   submission's `group_id` with any song-column rows of the same submission.
3. **Review** — the admin decides each link row on its own (mock screen 3, option A).
4. **Apply** — approving writes that one `song_links` row; nothing else about the array moves.
5. **Retype** — `links` stops being a `songs` suggestion column and stops being a refusable
   catalog column (full enumeration below).

Not in this task: adding a link (additions stay direct — Fast View `updateSongLinksAction`,
`createAndAddSong`, the fill of an empty catalog); **reordering** (`position` is not a
correctable thing; an approved edit never moves a row); dropping `songs.links` or the
forward bridge trigger (RH-143); RH-111's requester-facing outcome banner (a link row's
outcome rides the same `suggestion_ids` mechanism, no new work there); any correction to
`albums` / `song_versions`.

## Data model

New migration `migrations/0022_link_row_suggestions.sql`:

- Widen `catalog_suggestions_check` to also admit `('song_links','url')`, `('song_links','label')`
  and `('song_links','removed')`. `('songs','links')` **stays in the SQL check**: approved and
  rejected rows of that kind are history and `ADD CONSTRAINT` validates every existing row.
  The TypeScript allowlist drops it (below), which is what makes it unwritable.
- For `target_table = 'song_links'`, `target_id` is a `song_links.id` (still no FK, like every
  `target_id`; a deleted link leaves orphans the queue's join hides). `removed` carries the
  JSON value `true`.
- Every `pending` `('songs','links')` row is set to `superseded` (reviewer null, no
  `rejection_reason`): a whole-array proposal cannot be mapped to rows without guessing which
  old url became which new one. Migration header says so.

`SongLink` gains an optional `id`; `songLinksJson` (`src/lib/songLinksSql.ts`) adds `'id', sl.id`
to its `json_build_object`, so every reader that already projects links (owner rows, playlists,
the queue's `song`) can address a row.

## Behavior

**Allowlist** (`src/lib/catalogSuggestionPayload.ts`). `CATALOG_SUGGESTION_COLUMNS.songs` loses
`links`; a new `song_links` entry holds `url` (http(s), same test as today), `label` (string) and
`removed` (only `true`). `parseLinks` and `isSongLink` are deleted. `CatalogSuggestionPayload`
and `CatalogSuggestionColumn` are still derived from the `songs` entry, so they lose `links`.
`parseCatalogSuggestionValue` keeps rejecting any pair outside the table.

**Submit** (`src/lib/moderation.ts`). `submitCatalogSuggestion` still takes a payload of song
columns; it additionally accepts an optional list of link changes
`{ linkId, url?, label?, removed? }` (a submission with only link changes is valid; a submission
with nothing is still refused). It fans out in one statement, one group, one `reason`. A link id
that is not a row of `songId` is refused with the `Invalid catalog suggestion` prefix and writes
nothing. `suggestionInsert` takes the target table and id per entry instead of one `targetId`.
`submitCatalogSuggestionAction` and the `SongCorrectionInput` type carry the same field
(`linkChanges`) instead of `links`. A row marked removed carries no `url`/`label` rows.

**Fast View / `applySongLinkUpdate`** (`src/lib/songs.ts`). No longer queues `{ links: [...] }`.
Submitted links absent from `song_links` are written directly, as today. Existing rows whose url
is absent from the submission each become a `('song_links','removed')` suggestion keyed by that
row's id, and the result reports `pending: true` when at least one was queued. Kept rows keep
today's label upsert. (Behaviour change, deliberate: a mixed add-and-remove edit used to write
nothing; now the add lands and only the removal waits.)

**Pending queue read** (`catalogSuggestionSql.ts`). `PENDING_SUGGESTION_GROUPS_SQL` currently
aggregates `jsonb_object_agg(target_column, value)`, which would collide on repeated `url`
columns. Link-row suggestions are projected separately per group as an ordered list of
`{ suggestion_id, link_id, column, value, current link }`, joining `song_links` on
`c.target_id` to find the song. `PendingCatalogSuggestionGroup` gains that list and its
`proposed_data` no longer carries `links`. `PendingEditDiff` renders the list as rows, not as
`JSON.stringify`.

**Review** (`reviewCatalogSuggestionGroup`). Gains an option naming the link-row suggestion ids
the admin rejects while approving the rest (an options object — the function is at `max-params`
4). Ids that are not link rows of this group are refused. Rejected ids get `rejected` with the
given reason; the others are approved. `ModerationQueue` / `PendingEditCard` render per-row
Accept/Reject as in mock option A and the action bundle passes the option through.
Per-row verdicts (option A) are the committed design; the A-versus-B decision is pending operator confirmation at spec_approval.

**Apply** (`applyApprovedGroup`). `approvedLinksOf` and the replace-set `applyApprovedSongLinks`
are deleted. For each approved link row: `removed` → `DELETE FROM song_links WHERE id = $1`;
`url` / `label` → `UPDATE song_links SET <column> = $2 WHERE id = $1` through a closed
column-to-statement map (the column name is never interpolated). A `url` that collides with
another row of the same song (`UNIQUE (song_id, url)`) is refused with the
`Invalid catalog suggestion` prefix before any write and aborts the group. The song's
`updated_at` is still bumped once per approved group (`catalogTimestampGuard` still scans the
`UPDATE songs` statement textually — keep it in `moderation.ts`). Approving a `removed` row also
supersedes every other pending suggestion on that link id (the row is gone); approving a
`url`/`label` row supersedes pending competitors on the same `(link id, column)`. Approval never
touches `position`.

**Correction form** (`CorrectionModal.tsx`, `SongForm.tsx`, mock screens 1-2). The links block
lists the catalog's rows keyed by id, each with editable label and url and a Remove / Undo
control; unchanged rows send nothing; the added-row editor (`SongLinksEditor`) is not used here
(it stays in `SongForm` for the empty-catalog fill). In `SongForm`'s locked list each row gets
its own "Suggest a correction" button, which opens the modal with that row focused (new
`focusLinkId` prop). `changedCatalogFields` stops handling links; a sibling pure function in
`catalogFields.ts` returns the link changes from the catalog rows and the draft rows.

**Fill on an empty catalog** is unchanged in behaviour but moves out of the column loop:
`applyCatalogFill` fills links iff `song_links` has no row for the song (`ON CONFLICT DO
NOTHING`), and a song that already has rows neither fills nor refuses on links.

## Retype inventory (the RETYPE HAZARD)

`'links'` leaves `CATALOG_COLUMNS` (so `CatalogColumn`), `RefusableCatalogColumn`
(`src/types/database.ts`), `CATALOG_SUGGESTION_COLUMNS.songs` (so `CatalogSuggestionColumn`,
`CatalogSuggestionPayload`), and `SongLink[]` leaves `CatalogFieldValue` and
`CatalogSuggestionValue`. Every reader, each of which must compile and be re-tested:

| Disappears | Readers that change |
|---|---|
| `'links'` in `CATALOG_COLUMNS` / `CatalogColumn` | `catalogFields.ts`: `CatalogFill.column`, `REFUSABLE`, `REQUIRED_COLUMNS`, `putIfChanged`, `isCatalogFieldEmpty` (links branch), `proposedValue`, `fillFor` (jsonb cast branch), `splitCatalogUpdate` loop; `songs.ts` `applyCatalogFill` (`linksFill` lookup, the "column names come from `CATALOG_COLUMNS`" interpolation) and `fillSongLinks` (parses `CatalogFill.value`); `SongForm.tsx` `focusField?: CatalogColumn`, `areLinksLocked`, the `setCorrection({ focusField: "links" })` button; `CorrectionModal.tsx` `focusField` |
| `'links'` in `RefusableCatalogColumn` / `RefusedCatalogField.column` | `CATALOG_FIELD_LABELS` (`Record<RefusableCatalogColumn, string>`: the `links` key becomes an excess property); `catalogDraftFromRefusals` (links branch); `describeCatalogValue` (array branch, dead once `CatalogFieldValue` loses `SongLink[]`); `CatalogRefusalNotice.tsx`; `SongForm.tsx` (`useState<RefusedCatalogField[]>`, `catalogDraftFromRefusals(refused)`); `catalogFields.test.ts` key-list assertion |
| `links` in `CatalogSnapshot` / `CatalogProposal` | kept as plain non-column fields feeding only the empty-catalog fill; `splitCatalogUpdate` no longer returns them in `fill` or `refused`; `songs.ts` snapshot construction |
| `links` in `CatalogDraft` / `changedCatalogFields` | `catalogDraftFromSong`; `CorrectionModal` `base`/`draft` state and `set`; `SongForm` `prefill?: Partial<CatalogDraft>`; `SongCorrectionInput.links` → `linkChanges` |
| `links` in `CatalogSuggestionPayload` / `CatalogSuggestionValue` | `moderation.ts` `ApprovedField`, `approvedLinksOf`, the `Array.isArray(value) ? JSON.stringify(value)` line in `applyApprovedGroup`; `catalogSuggestionPayload.test.ts` `SAMPLES` and its allowlist-versus-migration check |

`Song.links` and the `songs.links` column are **not** touched (RH-143). `SongFormEditInput.links`
stays for the empty-catalog fill. `AGENTS.md` (Song Links paragraph) and `docs/use-cases.md`
§ *Suggest a correction to the catalog* are updated to say a link correction is per row.

## Files touched

- `migrations/0022_link_row_suggestions.sql` — widen check, supersede legacy pending rows.
- `src/types/database.ts` — drop `links` from `RefusableCatalogColumn`, `SongLink[]` from `CatalogFieldValue`; `SongLink.id?`; `PendingCatalogSuggestionGroup` link-row list.
- `src/lib/catalogFields.ts` — retype above; link-change helper; fill helper.
- `src/lib/catalogSuggestionPayload.ts` — allowlist per table, delete `parseLinks`.
- `src/lib/catalogSuggestionSql.ts` — per-entry table/target in `suggestionInsert`; queue projection; supersede statements.
- `src/lib/moderation.ts` — submit link changes, per-row review option, per-row apply.
- `src/lib/songs.ts` — `applySongLinkUpdate` queues removals by id; `applyCatalogFill` links fill.
- `src/lib/songLinksSql.ts` — `id` in `songLinksJson`.
- `src/app/actions/moderation.ts`, `src/app/admin/moderation/page.tsx` — carry the new shapes.
- `src/components/songs/SongForm.tsx`, `CorrectionModal.tsx` — per-row UI.
- `src/components/admin/ModerationQueue.tsx`, `PendingEditCard.tsx`, `PendingEditDiff.tsx` — per-row review.
- Tests beside each of the above, plus `e2e/songs-crud.spec.ts` / `e2e/helpers.ts` where they drive the links correction.

## Test criteria

- DB tests (`RUN_DB_TESTS=1`): submit → queue → approve each of remove / url edit / label edit
  on one row among three leaves the other two rows with unchanged ids and positions; a rejected
  row leaves its link untouched while an approved sibling lands; a colliding url edit is refused
  and writes nothing; a legacy pending `('songs','links')` row is `superseded` after migration.
- Unit tests: allowlist rejects `('song_links','position')`, and `parseCatalogSuggestionValue('songs','links',…)` throws `Invalid catalog suggestion`; `applySongLinkUpdate` with a removal queues a `removed` suggestion keyed by the link id, writes an added link immediately and returns `pending: true`;
  `changedCatalogFields` never emits links; link-change helper emits nothing for untouched rows.
- Component tests: the correction form renders exactly one edit/remove control set per catalog row id and an
  untouched submit is refused; the queue card renders a verdict control per link row.
- Gates: `npx tsc --noEmit`, `npm run lint` (check `$?`, see AGENTS.md rtk note), `npm run lint:dead`,
  `npm run lint:dup`, `npm run test:coverage`. There is no `typecheck` script beyond
  `typecheck:sw`; this task does not add one, so the command is run literally.

## Expected Results

- [ ] ER1: `npx tsc --noEmit` exits 0 (checked via `$?`, not through the rtk wrapper).
- [ ] ER2: `'links'` is absent from `CATALOG_COLUMNS`, `RefusableCatalogColumn` and the `songs` suggestion allowlist.
- [ ] ER3: Submitting a correction that removes one link and edits another stores one `catalog_suggestions` row per change, each with `target_table = 'song_links'` and the link's `song_links.id` as `target_id`, sharing one `group_id`.
- [ ] ER4: Approving a link-row suggestion changes only that `song_links` row; every other row of the song keeps its `id`, `position` and values.
- [ ] ER5: Rejecting one link row while approving the rest leaves the rejected link unchanged and marks that suggestion `rejected`.
- [ ] ER6: An approved url edit that collides with another link of the same song is refused before any write and the group stays pending.
- [ ] ER7: The correction form submits nothing when no link row was touched (component test passes).
- [ ] ER8: `migrations/0022` applies on a database holding a pending `('songs','links')` row and leaves that row `superseded`.

## Out of Scope

Reordering links, adding a link through the correction form, `songs.links` removal (RH-143),
RH-111 banner changes, corrections to `albums` / `song_versions`.

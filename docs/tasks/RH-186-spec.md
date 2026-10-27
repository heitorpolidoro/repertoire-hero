# RH-186 — Add per-user custom fields to songs, starting with a pedalboard Preset

Mock: [`docs/tasks/RH-186-mock.html`](RH-186-mock.html) — the Settings "Custom fields"
section and the Fast View `CustomFieldsSection`, every state listed below.

## Scope

The operator wants to record, per song, information the app has no column for. The first
use is **Preset**: which preset of their pedalboard they use on a song. The field belongs
to the musician alone. Many users may end up wanting the same field, but the operator does
not want it global now (decided 2026-10-26).

This task lets a signed-in user:

- **Manage their own field definitions in Settings**: add (a name), rename, move up or
  down, and delete after a confirmation. A definition is a name plus a type; this task
  ships the `text` type only.
- **Read and set a value per song version in Fast View**, directly under the song
  identity header, for every field they defined.

It does **not** cover: shared (band or global) definitions, types other than text, showing
or filtering by custom fields anywhere outside Fast View, bulk editing, translated copy,
or a landing-page change (see Out of Scope).

### Decisions

1. **Definition and value are separate tables**, so a field can become shared later
   without migrating values.
2. **Definitions are user-owned now.** `custom_fields.owner_user_id` is `NOT NULL`. A
   later task may add a scope and relax the owner column; nothing here may assume the
   owner is the only possible reader beyond the authorization checks below.
3. **A value always belongs to one musician**, even if definitions become shared:
   `custom_field_values` carries its own `user_id`.
4. **Values are keyed by `version_id`**, like every owner hold (the recording is the key),
   and never by a `user_songs` or `band_songs` id. A value can be set on a version
   nobody holds, and setting one never creates a repertoire row in either table.
5. **Band context changes nothing about custom fields.** The read and the write take no
   band id: Fast View under `?bandId=` shows and edits the signed-in user's own values,
   whatever their band role. There is no band value. This is **not** a fourth entry in
   `docs/use-cases.md` § "What creates a personal row in band context": that list is of
   writes that create a *repertoire* row, and this one creates none. The section gains a
   note saying so (see Docs).
6. **No fallback.** There is no version- or song-level value; an absent row means "Not
   set". A blank save deletes the row, so an empty string is never stored.
7. **Copy is inline English** (AGENTS.md F25). No dictionary key, no `getDictionary`, no
   third F25 exception.
8. **Not a selling point** on its own (AGENTS.md Landing Page Rule): no landing copy.

## Approach

### Data — `migrations/0030_custom_fields.sql` (next free number at implementation time)

- `custom_fields`: `id uuid` pk, `owner_user_id uuid` → `profiles(id)` on delete cascade
  (the owner reference `user_songs` and `song_files` use),
  `name text NOT NULL`, `type text NOT NULL DEFAULT 'text' CHECK (type IN ('text'))`,
  `position int NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`; a unique index
  on `(owner_user_id, lower(name))`.
- `custom_field_values`: `field_id` → `custom_fields` on delete cascade, `user_id uuid` →
  `profiles(id)` on delete cascade, `version_id` → `song_versions` on delete cascade,
  `value text NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`;
  `PRIMARY KEY (field_id, user_id, version_id)` and an index on `(user_id, version_id)`.
- A `CHECK` that `value` is not blank after trimming, so the "blank means absent" rule is
  held by the database too.

### Rules — `src/lib/customFieldRules.ts` (new, pure, client-safe)

The limits and normalisation both sides share: a name is trimmed and must be 1–40
characters; a value is trimmed and must be at most 200 characters, and trimmed-empty
means "clear". It also holds the four user-facing messages, verbatim:

- `You already have a field with that name.`
- `Field name must be 1 to 40 characters.`
- `Value must be at most 200 characters.`
- `Custom field not found`

### Data access — `src/lib/customFields.ts` (new, server-only)

Every function takes the signed-in user's id as its first argument and scopes every
statement by it. Kept out of `ownerSongs.ts` (400-line budget).

- **List** the user's definitions ordered by `position, id`.
- **Create** at `max(position) + 1`; **rename**; both refuse an invalid name and turn the
  unique-index violation (`23505`, the E1 pattern, single statement) into the duplicate
  message. Renaming a field to a different case of its own name is allowed.
- **Move** up or down: swaps `position` with the adjacent field of the same owner in one
  `withTransaction`; at either end it is a no-op. Positions are not renumbered after a
  delete — gaps are harmless because only the order is read.
- **Delete**: the cascade removes every value of the field.
- **Read values for a version**: every definition of the user, in order, each with that
  user's value for that version or `null`.
- **Set a value**: upsert (its `SET` list carries `updated_at = now()`, the repo's
  convention instead of a trigger), or delete when the trimmed value is empty; the row is
  written only through the user's own definition, so a field id the user does not own
  writes nothing. It answers the stored value, `null` after a clear. A blank set checks
  that the user owns the field *before* it deletes, because a delete that matches nothing
  cannot tell "no value yet" from "not your field".
- Rename, move, delete and set throw `Custom field not found` when the user owns no field
  with that id (zero rows affected). The four messages are thrown outside the L1 wrapping
  `try` so they reach the UI verbatim (L1a).

Types: `CustomField` (`id`, `name`, `position`) and `CustomFieldEntry` (`fieldId`, `name`,
`value: string | null`) live in a **new `src/types/customField.ts`, not in
`src/types/database.ts`**: that file is exactly at the 400-line `max-lines` budget, so
appending to it fails `npm run lint` and the ratchet forbids an override.
`pendingFieldGroup.ts` and `pendingLinkChange.ts` are the precedent, and the new file
carries the same "kept beside `database.ts` rather than in it" header line. Any
projection that is not one of them goes in `src/lib/dbRows.ts` (170 lines).

### Server Actions — `src/app/actions/customFields.ts` (new)

Thin (A2): each resolves the user with `getRequiredUserId()` and delegates, with no
`try/catch` and no user id taken from the client. Seven actions, each named `…Action`
(`namingConventions.test.ts` fails otherwise): `listCustomFieldsAction()`,
`createCustomFieldAction(name)`, `renameCustomFieldAction(fieldId, name)`,
`moveCustomFieldAction(fieldId, direction)` with `direction` `'up' | 'down'`,
`deleteCustomFieldAction(fieldId)`, `getCustomFieldValuesAction(versionId)` and
`setCustomFieldValueAction(fieldId, versionId, value)`. None takes a band id. The
`src/app/actions` guard suites scan this file too: no `query(`, no `@/lib/db` import and
no `band_members` in it, and every action body contains `getRequiredUserId()`.

Bundles in a new `src/app/customFieldActions.ts`, as module-level consts:
`CUSTOM_FIELD_SETTINGS_ACTIONS` (the five definition actions) and
`SONG_CUSTOM_FIELDS_ACTIONS` (the read and the set).
**The bundle keys are the action names without the suffix** (`listCustomFields`,
`createCustomField`, `renameCustomField`, `moveCustomField`, `deleteCustomField`;
`getCustomFieldValues`, `setCustomFieldValue`) and they are load-bearing:
`offlineFirst` classifies a method by its bundle key, and a key that matches no
`OFFLINE_READERS` entry is refused offline as an unknown write (see Offline).

### Fast View — `CustomFieldsSection`

- `src/hooks/useSongCustomFields.ts` loads the entries for the route's version on mount
  and on every version change, discarding an answer (or a failure) that arrives for a
  version no longer on screen. A failed load raises the error through `notify` and leaves
  the entries as they were. `save` calls the set action, replaces that one entry with the
  stored value, and on failure raises the error through `notify` and keeps the old value.
  It is a separate per-version read, **not** part of the RH-134 song window, so it takes
  no `onSaved`: the window cache holds nothing about custom fields, and
  `afterWrite` / `invalidateCurrent` would drop an entry that did not change.
- `src/components/fastview/CustomFieldsSection.tsx` owns its controller, as
  `AudioLibrarySection` does, and takes `versionId`, `actions`, `readOnly` and `notify`.
  It renders `<section aria-label="Custom fields">`:
  - **no definitions** — nothing at all;
  - **online** — one line per definition, in order: a filled field reads `Preset: Lead 3B`
    with an `Edit` button; an empty one reads `Preset:` then a muted `Not set` with a `Set`
    button. Both open the same inline editor: a text input (max 200, prefilled with the
    value), `Save`, `Clear` (saves blank) and `Cancel`. Buttons are disabled while a save
    is in flight;
  - **offline** (`readOnly`) — only the filled fields, each with its `Edit` button
    disabled; empty fields are not rendered, and with no filled field the section renders
    nothing (the `SongTuningControl` rule for an empty read-only value).
- **Editability is decided by `isOffline` alone.** The page passes `readOnly={isOffline}`,
  **not** the page's `readOnly` (`isOffline || !song.ownerRowId`): a value needs no owner
  row (Decision 4) and no band role (Decision 5).
- `src/app/songs/[versionId]/fast-view/page.tsx` renders it directly after
  `SongIdentityHeader`, as one single-line element (the shape of `AudioLibrarySection`'s)
  with `versionId`, `OFFLINE_FIRST_SONG_CUSTOM_FIELDS_ACTIONS`, `readOnly={isOffline}`
  and `notify={showToast}`. `FastViewPage` is exactly at the 200-line
  `max-lines-per-function` budget (lines 99 to 298): it must stay within it with **no**
  new override (the ratchet only shrinks), so the developer recovers the one line the
  element costs inside the function, for example a JSX comment that only repeats the
  component name below it.
- The page docblock says one `readOnly` expression disables "every write control the
  page can reach". It gains a sentence that the custom-fields section is the exception,
  taking `isOffline` alone, so the comment does not lie after this task.

### Settings — `CustomFieldsSettingsSection`

- `src/hooks/useCustomFieldSettings.ts`: loads the list on mount, and exposes add, rename,
  move, a two-step delete (request → confirm/cancel) and one inline error. Every
  successful write reloads or patches the list so it shows the saved order.
- `src/components/settings/CustomFieldsSettingsSection.tsx`, placed in
  `src/app/settings/page.tsx` between the Spotify section and `OfflineStorageSection`,
  given `CUSTOM_FIELD_SETTINGS_ACTIONS` and `offline` from `useOfflineStatus()` read in
  the page. It shows:
  - heading `Custom fields` and the line `Your own notes on every song, like the
    pedalboard preset you use. Only you see them.`;
  - the empty state `No custom fields yet.`;
  - one row per field: the name, `Move up` / `Move down` arrow buttons (the first row's
    up and the last row's down disabled), `Rename` and `Delete`;
  - `Rename` swaps the name for an input (max 40) with `Save` and `Cancel`;
  - `Delete` opens a `ConfirmPanel` under the row: `Delete "Preset" and its value on every
    song?`, confirm label `Delete` — never `confirm()`;
  - an add form: input (placeholder `Field name, e.g. Preset`, max 40) and an `Add field`
    button, disabled while the trimmed input is empty;
  - errors (duplicate name, invalid name, a failed load: `Could not load your custom
    fields.`) as an inline `role="alert"` under the form. While loading and after a failed
    load the empty state is **not** shown: the list is unknown, not empty (the mock's
    "could not load" card).
- Offline, every write control (add, rename, move, delete) is disabled.
- The page's component function is 176 lines, so the one `useOfflineStatus()` call and
  the one element fit inside the 200-line budget with room to spare.

### Offline

What one captured song carries changes, and the rules are those of the
`OFFLINE_SCHEMA_VERSION` docblock in `src/lib/offlineSnapshot.ts`:

- `OfflineSongSnapshot` gains `customFields?: CustomFieldEntry[]` — **optional, and
  `OFFLINE_SCHEMA_VERSION` stays 6**, on the `contentType` / `isPrimary` precedent.
  Absent is a fact, not a guess: the song was downloaded before this task. A bump would
  discard every downloaded playlist and its cached PDF bytes on first launch, recoverable
  only online, to avoid showing *nothing* where a value exists — and showing nothing is
  not a wrong value. So a song downloaded before RH-186 shows no custom fields offline
  until it is downloaded again, and a value saved *after* a download is not in that copy
  either (the snapshot is a photograph; no Fast View write patches it). The decision is
  recorded in the JSDoc on `customFields?`, beside the `contentType` and `isPrimary`
  ones on `OfflineTabSnapshot` (that is where those two rationales live), plus one
  closing sentence in the `OFFLINE_SCHEMA_VERSION` docblock so a reader looking there
  for a bump finds why there is none. `isSongSnapshot` accepts an absent field and
  refuses a present one that is not an array of `{ fieldId: string, name: string,
  value: string | null }`. `offlineSnapshot.ts` is 351 of 400 lines: the field, its
  JSDoc (as long as `contentType`'s, no longer), the entry check and the docblock
  sentence must fit in the remaining 49, so the entry check is one small function.
- `OfflineSongMaterial` (`offlineSnapshot.ts`) and `OfflineSongInput`
  (`src/lib/offlineStore.ts`) gain a required `customFields`, which `writePlaylist` and
  `buildOfflineSnapshot` carry into the record. Every existing fixture that builds one
  gains `customFields: []`; `offlineSnapshot.test.ts` has four such literals (see Test
  criteria for its line budget).
- **Capture**: `OfflineCaptureActions` (`src/lib/offlineCapture.ts`) gains
  `getCustomFieldValues(versionId)`, and `captureResolvedEntry` calls it with the resolved
  entry's `version_id`. A failure fails the download (all-or-nothing, as `getTabs`).
  `OFFLINE_DOWNLOAD_ACTIONS` (`src/app/offlineActions.ts`) wires it to the new read
  action. The playlist download (`useOfflinePlaylist`) and the single-song download
  (`useOfflineSong`) both get it through the shared capture, and every fixture typed
  `OfflineCaptureActions` or `OfflineDownloadActions` gains the member.
- **Read**: `OFFLINE_READERS` (`src/lib/offlineFirst.ts`) gains `getCustomFieldValues`,
  answering `findSong(versionId)?.customFields ?? []`; the comment above the table that
  counts the reads is updated with it. Without that entry the read would be refused
  offline. The set action (`setCustomFieldValue`) stays unclassified, so offline it is
  refused with `OFFLINE_WRITE_MESSAGE` and never reaches the network.
- **Wrapping**: `src/app/fastViewOfflineActions.ts` exports
  `OFFLINE_FIRST_SONG_CUSTOM_FIELDS_ACTIONS = offlineFirst(SONG_CUSTOM_FIELDS_ACTIONS)`.

### Docs

- `docs/behavior.md`: the lines under Behavior changes, in the same change.
- `docs/use-cases.md` § "What creates a personal row in band context": after the list, a
  short note that a custom field value is also the musician's own in band context but
  creates no repertoire row in either table, which is why the count stays three.
- `AGENTS.md`: a Domain Concepts bullet for custom fields (the two tables, user-owned
  definitions, version-keyed per-user values, no band value, the types in
  `src/types/customField.ts` because `database.ts` is at its cap), and the same "creates
  no repertoire row" note next to the "three deliberate per-musician exceptions"
  sentence.

### Test criteria

The `max-lines` budgets (400 for source, 800 for tests) were checked against every
existing file named below. Two have no room and gain nothing beyond what is said here:
`src/types/database.ts` (400 of 400, hence the new types file) and
`src/lib/__tests__/offlineSnapshot.test.ts` (776 of 800: only its four
`customFields: []` fixture lines, to 780, and **none** of the new snapshot tests). The
rest have room: `fastViewPage.test.tsx` 489, `offlineFirst.test.ts` 568,
`useOfflinePlaylist.test.tsx` 448, `useOfflineSong.test.tsx` 308,
`actionSessionGuard.test.ts` 298, `OfflineDownloadButton.test.tsx` 224,
`OfflineSongButton.test.tsx` 142, `settingsPage.test.tsx` 98.

New test files:

- `src/lib/__tests__/customFieldRules.test.ts`: trimming, the 1–40 and 200 limits, blank
  means clear.
- `src/lib/__tests__/customFields.db.test.ts`: create, rename, move, delete scoped to the
  owner; case-insensitive duplicate refused for the same user and allowed for another;
  move at either end is a no-op; delete cascades the values; blank set deletes the row
  (and a blank set on a field the user does not own throws); value per user and per
  version; a set in personal and in band context creates no `user_songs` or `band_songs`
  row; every call by user B on user A's field id affects zero rows and throws
  `Custom field not found`; B's read of the same version returns none of A's fields.
- `src/app/actions/__tests__/customFields.test.ts`: each action calls the lib with the
  session user's id first, then the client's arguments unchanged, and takes no user id
  from the client.
- `src/hooks/__tests__/useSongCustomFields.test.tsx` (stale-version answer discarded,
  save patches one entry, a failed save and a failed load notify and keep the value) and
  `src/hooks/__tests__/useCustomFieldSettings.test.tsx` (two-step delete, error
  surfaced).
- `src/components/fastview/__tests__/CustomFieldsSection.test.tsx`: hidden with no
  definitions; filled and `Not set` lines; save; clear; with `readOnly` only the filled
  fields are shown and their `Edit` is disabled; without it `Edit` and `Set` are
  enabled. **It cannot pin the unheld-version rule**: the component takes `readOnly` as a
  prop and has neither an owner row nor a band id as input, so a test here passes
  whatever the page passes. The rule is pinned at the page, below.
- `src/components/settings/__tests__/CustomFieldsSettingsSection.test.tsx`: add, rename,
  move, delete through the confirmation, duplicate error, a failed load shows the alert
  and not the empty state, controls disabled offline.
- `src/lib/__tests__/offlineSnapshotCustomFields.test.ts` (the snapshot tests, in a file
  of their own, with a small fixture of its own rather than a copy of the 20-line
  helpers in `offlineSnapshot.test.ts`, which `npm run lint:dup` could flag): the values
  survive `buildOfflineSnapshot` and a `readValidSnapshot` round trip; a song with no
  `customFields` validates; a present `customFields` that is not an array of
  `{ fieldId, name, value }` is refused; `OFFLINE_SCHEMA_VERSION` is still 6.

Existing files extended:

- `src/app/songs/__tests__/fastViewPage.test.tsx` gains one `describe`, "Fast View custom
  fields (RH-186 ER6)", beside "Fast View at a version with no owner row (RH-132 ER9)".
  It is the only suite that renders the page, so the only one that can catch the
  regression that matters: the page wiring `readOnly={readOnly}`
  (`isOffline || !song.ownerRowId`) in place of `readOnly={isOffline}`.
  - With two entries (one filled, one not set) and `ownerRowId: null`, in personal
    context and again under `?bandId=`, the section's `Edit` and `Set` buttons are
    enabled **while the Lyrics `Edit` is disabled in the same render**, and saving
    reaches `setCustomFieldValue` once with exactly `(fieldId, ROUTE_VERSION_ID, value)`
    and no band id.
  - With the offline signal on, `Edit` is disabled and the not-set field is not rendered.
  - The file's `@/app/fastViewOfflineActions` mock gains
    `OFFLINE_FIRST_SONG_CUSTOM_FIELDS_ACTIONS` (`getCustomFieldValues` and
    `setCustomFieldValue` as `call(...)` spies, the bundle built once like the others,
    F21); without it the page's import fails on a missing export, in every test of the
    file. `beforeEach` defaults the read to `[]`, so the existing tests keep seeing no
    section. The file's `useOfflineStatus` mock becomes switchable (default online) for
    the offline case.
- `src/app/actions/__tests__/actionSessionGuard.test.ts`: one `FAIL_CLOSED` entry per new
  action, all `throws`. That suite asserts the table has exactly one entry per exported
  action, so it fails as soon as the seven actions exist without them. This is the
  "refuses without a session" check; `customFields.test.ts` does not repeat it.
- `src/lib/__tests__/offlineFirst.test.ts`: offline, `getCustomFieldValues` answers the
  captured values, and `[]` for a song captured without them or in no playlist;
  `setCustomFieldValue` is refused with `OFFLINE_WRITE_MESSAGE` without calling the
  action. Its `seededStore` helper gains an optional `customFields` per seeded song. The
  file uses plain functions, no `vi.fn` (its docblock).
- `src/hooks/__tests__/useOfflineSong.test.tsx`: the read is called with the version id
  and its answer is stored on the snapshot song, and a rejection fails the download.
  `useOfflinePlaylist.test.tsx`: each stored song carries its values. The two hooks share
  `captureResolvedEntry`, so together they cover it. The `makeActions` fixtures of both,
  and of `OfflineDownloadButton.test.tsx` and `OfflineSongButton.test.tsx`, gain
  `getCustomFieldValues`, since their downloads now call it and would otherwise fail
  with "is not a function".
- `src/app/settings/__tests__/settingsPage.test.tsx`: mocks `@/app/customFieldActions`
  (a stub bundle whose list answers `[]`), as it already mocks `OfflineStorageSection`,
  so the page's new import keeps the Server Action graph out of jsdom. Its Spotify
  assertions are unchanged.

## Behavior changes

- changed: Repertoire and overrides — A write reaches exactly one owner: personal context writes the user's row, band context writes the band's row; a custom field value takes no owner context and always lands on the signed-in user, in no repertoire table. (RH-186)
- changed: Repertoire and overrides — Every write to a band's repertoire requires a band admin; members can only read it. A custom field value is not part of a band's repertoire: any member sets their own in band context. (RH-186)
- added: Repertoire and overrides — A user defines their own text custom fields in Settings (add, rename, move, delete after confirmation), with names unique per user ignoring case. (src/lib/customFields.ts, src/components/settings/CustomFieldsSettingsSection.tsx) (RH-186)
- added: Repertoire and overrides — Fast View lists each of the user's custom fields with their own value for the version, editable whenever online regardless of band role or held row; a blank save deletes the value. (src/components/fastview/CustomFieldsSection.tsx, src/hooks/useSongCustomFields.ts, src/lib/customFields.ts) (RH-186)
- changed: Offline — Marking a playlist or a single song available offline stores a snapshot of everything readable about it, including the reader's own custom field values; a copy taken before RH-186 has none. (RH-186)
- changed: Offline — A method the offline layer does not know is refused rather than served; the custom field read is answered from the snapshot and the custom field write is refused. (RH-186)
- changed: Offline — Controls that write across the network are disabled offline, including uploads, links, lyrics saving, drawing and custom field edits. (RH-186)

## Expected Results

- [ ] In Settings, a user who adds `Preset` and `Amp`, renames `Amp` to `Pedal` and moves it above `Preset` sees `Pedal` then `Preset` in their "Custom fields" list after a page reload.
- [ ] Adding `preset` while the same user already has `Preset` is refused with the inline error `You already have a field with that name.`, and another user can still add `Preset` (`customFields.db.test.ts`).
- [ ] Deleting `Preset` after confirming `Delete "Preset" and its value on every song?` leaves no `custom_field_values` row for that field (`customFields.db.test.ts`).
- [ ] A Preset value saved in Fast View (`Lead 3B`) is shown when that version is reopened and reads `Not set` on every other version of the song.
- [ ] Clearing Preset in Fast View deletes its `custom_field_values` row instead of storing an empty string, and the field reads `Not set` again (`customFields.db.test.ts`, `CustomFieldsSection.test.tsx`).
- [ ] In band context, a plain band member saves Preset on a version neither they nor the band hold, and no `user_songs` or `band_songs` row is created (`fastViewPage.test.tsx`, `customFields.db.test.ts`).
- [ ] Every call user B makes on user A's field id affects zero rows and throws `Custom field not found`, and B's read of the same version lists none of A's fields (`customFields.db.test.ts`).
- [ ] Offline, a song downloaded after saving `Lead 3B` shows `Preset: Lead 3B` in Fast View with its Edit button disabled.

## Operator Results Coverage

The operator's nine original results, each mapped to the spec section and the returned
result that covers it (ER1 to ER8 are the Expected Results above, in order). Eight
results cannot carry nine compound ones one-for-one, so a clause with no result of its
own is named with the test that holds it.

1. Create, rename, reorder and delete in Settings; deletion removes the values; the list
   shows only the user's own fields in their saved order. § Settings and § Data access;
   ER1 (create, rename, reorder, saved order after a reload), ER3 (delete removes the
   values), and the owner scoping in `customFields.db.test.ts`.
2. A case-insensitive duplicate is refused with a visible error; another user can still
   create the name. § Data access (create, rename) and § Settings; ER2.
3. Fast View shows each field under the header and saves a value shown again on reopen;
   a user with no fields sees no section. § Fast View; ER4 for save and reopen. "No
   section" is held by `CustomFieldsSection.test.tsx` ("hidden with no definitions").
4. An empty value leaves no row and the field shows empty again. Decision 6 and
   § Data access (set); ER5.
5. Values are per user and per version. Decisions 3 and 4; ER4 (per version), ER7 (another
   user's read lists none of the first user's fields).
6. Band context: the user edits their own value whatever their role, and no `user_songs`
   or `band_songs` row is created. Decision 5 and § Fast View; ER6.
7. Another user's field definition: zero rows and an error. § Data access; ER7.
8. Offline Fast View shows the saved values read-only. § Offline; ER8.
9. `npm run lint`, `lint:dead`, `lint:dup` and the vitest suite pass, and every new UI
   string exists in `en.json` and `pt-BR.json`. The gates apply to every task and are not
   restated as a result. **The i18n clause is not carried**: AGENTS.md F25 scopes i18n to
   the landing page, so Decision 7 keeps this copy inline English and adds no dictionary
   key. Flagged for the operator at approval.

## Out of Scope

Shared (band or global) definitions; field types other than text (select, number,
checkbox); showing custom fields in the repertoire list, playlist rows or anywhere besides
Fast View; filtering or sorting by them; bulk editing; a cap on the number of fields;
Portuguese copy; landing-page copy; making a value part of the RH-134 song window.

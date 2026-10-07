# RH-135 — Fix the Spotify push finding no track links

> Filename note: the repo convention is spec filename = board id + 1, so
> `RH-136-spec.md` is the spec for board task **RH-135**. Deliberate.

## Scope

A live bug fix, measured at `4932826`. The push branch of
`POST /api/spotify/playlists/[id]/sync` selects a song's Spotify link by the
literal label `'spotify'` (`src/app/api/spotify/playlists/[id]/sync/route.ts:135`,
`links?.find((l) => l.label === 'spotify')`). No writer in `src/` produces that
spelling — `grep -rn "label: 'spotify'" src/ | grep -v __tests__` returns **0**
today. The three real writers produce:

| Writer | Label written |
|---|---|
| `src/hooks/useSongPicker.ts:197` | `'Spotify'` |
| `src/components/songs/RepertoireDashboard.tsx:246` | `"Spotify"` |
| `src/lib/spotifyPlaylistSync.ts:122` | `track.title.trim()` — the song's own title |

and `src/hooks/useSongLinks.ts:88` writes whatever the musician typed, else the
fetched page title, else the URL (`resolveLinkLabel`, `src/lib/songLinks.ts:23`).
So `uris` is built empty for every song, the `uris.length > 0` guard at
`route.ts:144` is never entered, and the route answers success having pushed
nothing.

This task replaces the label comparison with a **URL-host** check, adds the
tests that would have caught it, and de-traps the three fixtures that hid it.

Not in scope: the provider-column refactor (RH-110 Parts 1–3, which later
replace this host check with a derived column), the pull branch, batching,
auth, any UI, any schema change.

## Approach

### Behavior

1. A new pure module `src/lib/spotifyTrackUri.ts` decides, from a URL alone,
   whether a link is a Spotify **track** link and what its URI is. It exports
   two functions: one from a single URL string to `spotify:track:<id> | null`,
   and one from `SongLink[] | null` (the shape of `PlaylistVersionLinksRow.links`,
   `src/lib/dbRows.ts:73-77`) to the first match or `null`. It imports only the
   `SongLink` type from `@/types/database` — no DB, no `fetch`, no React, no
   `'use server'`.

   **Why a new module and not the route file:** `route.ts` is an App Router
   route handler; Next.js constrains its export surface to HTTP method handlers
   plus route-segment config (today it exports only `POST`, at line 27), so a
   helper exported from there is not unit-testable. **Why not
   `src/lib/spotifyPlaylistSync.ts`:** see *Sequencing hazard* below. Why not
   `src/lib/songLinks.ts`: that module is scoped to Fast View's links section
   and carries the `SongLinksController` contract; Spotify provider knowledge
   does not belong there, and a standalone module keeps RH-110 Part 2's
   replacement to one file. The new module sits inside the coverage include
   `src/lib/**/*.ts` (`vitest.config.ts`), so it is covered by the gate.

2. The host rule: parse with `new URL(url)`; a malformed URL yields `null`
   rather than throwing. Accept only when the protocol is `http:`/`https:`
   **and** the lowercased hostname is exactly `spotify.com` or ends with
   `.spotify.com`. Then apply the existing `track/([A-Za-z0-9]+)` match — the
   same regex now at `route.ts:137` — against the **pathname**, so a
   `?si=...` query or `#fragment` is irrelevant. Hostname equality/suffix, not
   substring: `notspotify.com` and `spotify.com.evil.io` must not match.

3. `route.ts:133-142` becomes a call to the list helper per playlist row,
   pushing the returned URI when non-null. The loop no longer reads
   `link.label` at all, and a song whose Spotify link sits behind an unrelated
   link (lyrics, tab) is now found, because the search is over every link
   rather than the first label match.

4. **URL-shape decision (decided, not deferred):**

   | Form | Verdict | Reason |
   |---|---|---|
   | `https://open.spotify.com/track/<id>` | **in** | the only form any writer produces — `external_urls.spotify` at `src/app/api/spotify/search/route.ts:132` and `src/lib/spotifyPlaylistSync.ts:73` |
   | `https://play.spotify.com/track/<id>` | **in** | legacy web-player host; free under the `.spotify.com` suffix rule |
   | `https://spotify.com/track/<id>`, `https://www.spotify.com/track/<id>` | **in** | hand-pasted; already present as a fixture at `src/lib/__tests__/songs.test.ts:298` |
   | same with `?si=...` or `#x` | **in** | match is on the pathname |
   | `spotify:track:<id>` (URI scheme) | **out** | **not** because it cannot be stored — it can. `isSongLink` (`src/lib/songEditPayload.ts:95`) validates a url against `HTTP_URL = /^https?:\/\/\S+$/i` (`:30`) only inside `parseLinks`, reached through `submitSongEdit` on the **moderation** branch (`src/lib/songs.ts:222`). The **additive** branch at `:228` runs a bare `UPDATE songs SET links = $1` with no url validation, and adding a brand-new link IS the additive case. So the column can hold a `spotify:` url. It stays out of scope because such a song is skipped today and nothing regresses by continuing to skip it — a deliberate scope line, not an impossibility. RH-110 Part 2 must not inherit the impossibility belief. |
   | `https://spotify.link/<code>`, `https://spoti.fi/<code>` | **out**, and it is the one real-world gap | a different eTLD+1, and resolving the redirect would mean a network round trip per song inside the push loop. Worth naming rather than tabling: `spotify.link` is what the Spotify **mobile** share sheet produces, so a musician who pastes a share link from their phone still gets a silently skipped song after this fix. No worse than today, but a known follow-up. |
   | `https://open.spotify.com/album/<id>`, `/playlist/<id>`, `/artist/<id>` | **out** | not a track; no `track/` segment, so no URI, and the song is skipped as before |
   | any other host containing the string `spotify` | **out** | rejected by construction (suffix rule, not substring) |

   An out-of-scope link makes its song contribute nothing to `uris` — the
   per-song skip that already exists. The push is not failed for it.

5. The three fixtures that hand-write the lowercase label
   (`src/lib/__tests__/spotify.test.ts:507`, `:520`, `:612`) are rewritten to a
   label a real writer produces (the song's own title, as
   `findOrCreateSong` writes). They must no longer assert, or depend on, any
   label convention. Their URLs stay `https://open.spotify.com/track/...` and
   their assertions stay unchanged — which is itself evidence that the fix is
   behaviour-preserving for already-passing cases.

### Files touched

- `src/lib/spotifyTrackUri.ts` — **new**; the two pure helpers described above.
- `src/app/api/spotify/playlists/[id]/sync/route.ts` — the push loop
  (currently lines 133-142) calls the helper instead of matching on
  `l.label === 'spotify'`; add the import.
- `src/lib/__tests__/spotifyTrackUri.test.ts` — **new**; ungated unit test of
  every row of the table in (4).
- `src/lib/__tests__/spotifyPushUris.db.test.ts` — **new**; the real-write-path
  push test (ER1). A **new file**, not an addition to `spotify.test.ts`:
  `eslint.config.mjs:134` pins that file to `max-lines: 678`, its exact current
  length, and the override list is a ratchet that may only shrink — so any line
  added there is a new lint error that cannot be legally silenced.
- `src/lib/__tests__/spotify.test.ts` — the three fixture labels from (5).
- `package.json` — version bump (`AGENTS.md:523`).

**Not touched:** `src/lib/spotifyPlaylistSync.ts`, `migrations/`,
`eslint.config.mjs`.

### Sequencing hazard

`src/lib/spotifyPlaylistSync.ts` is being modified concurrently by **RH-126**
(removing the dual write in `ensureInRepertoire`). This fix is designed to not
modify it: the helper lives in its own module, and the push loop is in
`route.ts`. The new DB test *imports* `findOrCreateSong` from it, which is a
read-only dependency on a function RH-126 does not change. If implementation
finds it must edit that file, stop and flag it rather than merging across
RH-126.

### No migration

No schema change: the fix reads the existing `songs.links` JSONB. `migrations/`
stays at `0018_add_song_file_content_type.sql`, so the unique-and-contiguous
four-digit prefix check in `src/lib/__tests__/migrationsSingleSource.test.ts`
is unaffected.

### Test criteria

The decisive test must **not** supply the link in the spelling the reader
wants — that is precisely how this bug survived three fixtures and a full
suite. It drives the real write paths and asserts the outbound body:

- Create song A through `findOrCreateSong` (`src/lib/spotifyPlaylistSync.ts`)
  from a `SpotifyRawTrack` whose `spotifyUrl` is
  `https://open.spotify.com/track/<idA>`. The stored label is therefore the
  song's title.
- Create song B through `createAndAddSong` (`src/lib/ownerSongs.ts:384`) with
  the picker's payload shape (`links: [{ label: 'Spotify', url:
  'https://open.spotify.com/track/<idB>' }]`, as `src/hooks/useSongPicker.ts:197`
  builds it), resolving its version with `representativeVersionId` from
  `src/lib/__tests__/test-helpers`.
- Insert both versions into a `playlist_songs` row set in a known order, stub
  `global.fetch`, invoke `syncPOST` with `{ direction: 'push' }`, and assert the
  `PUT .../playlists/<id>/tracks` body is exactly
  `{ uris: ['spotify:track:<idA>', 'spotify:track:<idB>'] }` — non-empty, in
  playlist position order.
- A third song carrying only a non-Spotify link contributes nothing and does
  not fail the push.

The ungated unit test covers the URL table directly, including the rejections,
and asserts a malformed URL returns `null` without throwing.

## Expected Results

- [ ] **ER1** `src/lib/__tests__/spotifyPushUris.db.test.ts` exists, is
  `describe.skipIf(!process.env.RUN_DB_TESTS)`-gated, and contains **no literal
  `label: 'spotify'`/`label: 'Spotify'` written directly into a `songs.links`
  SQL fixture**: every song it pushes is created through `findOrCreateSong`
  (`src/lib/spotifyPlaylistSync.ts`) or through `createAndAddSong`
  (`src/lib/ownerSongs.ts:384`) with the picker payload of
  `src/hooks/useSongPicker.ts:197`. It stubs `global.fetch` and asserts the
  `PUT https://api.spotify.com/v1/playlists/<spotifyPlaylistId>/tracks` request
  body parses to a **non-empty** `uris` array equal to
  `['spotify:track:<idA>', 'spotify:track:<idB>']` in playlist `position`
  order. `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/spotifyPushUris.db.test.ts`
  exits **0** with **0 failed and 0 skipped** tests.
- [ ] **ER2** The same suite contains a case where a playlist song's only link
  is a non-Spotify URL (e.g. `https://genius.com/x`): it contributes no entry
  to `uris`, the other songs' URIs are still pushed, and the route still
  answers HTTP 200.
- [ ] **ER3** `src/lib/spotifyTrackUri.ts` exists and exports the URL→URI and
  `SongLink[]`→URI helpers. `npx vitest run src/lib/__tests__/spotifyTrackUri.test.ts`
  exits **0** with **0 failed and 0 skipped**, and asserts, as named cases:
  `https://open.spotify.com/track/abc123` → `spotify:track:abc123`;
  `https://play.spotify.com/track/abc123` → `spotify:track:abc123`;
  `https://spotify.com/track/abc123` → `spotify:track:abc123`;
  `https://www.spotify.com/track/abc123?si=xyz` → `spotify:track:abc123`;
  and `null` for each of `spotify:track:abc123`, `https://spotify.link/abc123`,
  `https://open.spotify.com/album/abc123`, `https://notspotify.com/track/abc123`,
  `https://spotify.com.evil.io/track/abc123`, `''` and `'not a url'` — the last
  two returning `null` rather than throwing.
- [ ] **ER4** `grep -rn "label === 'spotify'" src/` returns **0 lines**
  (today: **1** — `src/app/api/spotify/playlists/[id]/sync/route.ts:135`). The
  path is scoped to `src/`, so it cannot match this spec or any landed spec
  under `docs/tasks/`.
- [ ] **ER5** `grep -rn "label: 'spotify'" src/` returns **0 lines** (today:
  **3** — `src/lib/__tests__/spotify.test.ts:507`, `:520`, `:612`). Same `src/`
  scoping.
- [ ] **ER6** `RUN_DB_TESTS=1 npx vitest run src/lib/__tests__/spotify.test.ts`
  exits **0** with **0 failed and 0 skipped**, proving the three rewritten
  fixtures and the existing push/batching assertions (including the >100-song
  batching case at `:601`) still hold.
- [ ] **ER7** `git diff --name-only` for the change does **not** list
  `src/lib/spotifyPlaylistSync.ts` (RH-126 owns it concurrently), does not list
  any file under `migrations/`, and does not list `eslint.config.mjs`.
- [ ] **ER8** `npx tsc --noEmit` exits **0** (it does today).
- [ ] **ER9** `npm run lint` reports **no finding on any file this task
  touches or adds**, and its project totals are no worse than today's tracked
  baseline of **8 errors / 9 warnings across 11 files**
  (`e2e/global-setup.ts`, `scripts/migrate.mjs`, `src/app/profile/page.tsx`,
  `src/app/reset-password/page.tsx`, `src/app/settings/page.tsx`,
  `src/components/landing/LandingPage.tsx`, `src/components/layout/AppLayout.tsx`,
  `src/components/layout/LanguageSelector.tsx`, `src/lib/__tests__/edge_cases.test.ts`,
  `src/lib/__tests__/errors.test.ts`, `src/lib/__tests__/i18n.test.ts`). The
  gate is "adds no new finding", not "exits 0". `eslint.config.mjs` still has
  exactly **14** `complexity-budget/override` entries, or fewer.
- [ ] **ER10** `npm run test:coverage` exits **0**, with the four thresholds in
  `vitest.config.ts` (statements 80, branches 65, functions 78, lines 80) met —
  `src/lib/spotifyTrackUri.ts` is inside the `src/lib/**/*.ts` include and is
  covered by its ungated unit test, since `test:coverage` sets no
  `RUN_DB_TESTS`.
- [ ] **ER11** `package.json` `version` is a patch bump above
  `0.1.149-202610071119` with a fresh `YYYYMMDDHHmm` suffix, higher than every
  version in `git log` (`AGENTS.md:523`).

## Out of Scope

- RH-110 Parts 1–3 (the derived provider column that replaces this host check).
- The pull branch of the sync route, batching, and `ensureInRepertoire`.
- Normalizing existing stored labels, or any backfill of `songs.links`.
- Resolving shortened Spotify links, `spotify:` URIs, and album/playlist/artist
  links — decided out in Approach (4).
- Any UI change. The route's response shape is unchanged.
- Landing-page copy (`AGENTS.md:526`, Landing Page Rule): **decided no**. This
  restores an already-advertised capability that was silently broken; it is not
  a new selling point, so `src/i18n/dictionaries/en.json` and `pt-BR.json`
  `landing.*` are untouched.

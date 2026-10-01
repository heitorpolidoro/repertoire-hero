# Feature and screen review

A walkthrough of every feature, one at a time: what it does today, where it
lives, and what is worth improving — in the product and in the code.

**Status legend:** ⬜ not reviewed · 🔄 in review · ✅ reviewed

## Progress

| # | Feature | Promised on landing | Status |
|---|---|---|---|
| 1 | Song catalog | yes (f1) | ✅ RH-84 |
| 2 | 5-stage mastery scale | yes (f2) | ✅ |
| 3 | Band shared repertoire | yes (f3) | ⬜ |
| 4 | Stage-ready Fast View | yes (f4) | ⬜ |
| 5 | Handwritten notes on PDF tabs | yes (f5) | ⬜ |
| 6 | Spotify integration | yes (f6) | ⬜ |
| 7 | Offline setlist | yes (f7) | ⬜ |
| 8 | Playlists / setlists | no | ⬜ |
| 9 | Community moderation | no | ⬜ |
| 10 | Repertoire tags | no | ⬜ |
| 11 | Musician profile | no | ⬜ |
| 12 | Band management | no | ⬜ |
| 13 | Band vs. personal lyrics | no | ⬜ |
| 14 | Localisation (en / pt-BR) | no | ⬜ |
| 15 | Accounts and authentication | no | ⬜ |

## Cross-cutting findings

Collected as the review proceeds; these outlive any single feature.

- **Band management is split across two pages.** `/profile` in band context
  renders `BandProfileView` (edit band, remove member, delete band) while
  `/bands/[id]` also offers "Edit Band". Two pages, 681 and 487 lines, both on
  the F15 "deferred, no named owner" list.
- **Playlists are the product's centre and have no landing card.** Everything
  the landing sells about the stage and about offline runs through a playlist.

---

## 1. Song catalog

**Reviewed:** 2026-09-23

### What it is

`global_songs` is a shared wiki-style catalog. Every musician's `repertoire`
row points at a catalog row rather than owning its own copy, so a song someone
else already entered arrives pre-filled with title, artist, album, key, cover
and links. `contributor_id` records who first entered it and, per its own
column comment, implies no ownership.

### Screens and entry points

| Screen | Role |
|---|---|
| `/` — `RepertoireDashboard` | The real entry point. One search box queries the catalog and Spotify in parallel, debounced, and offers "add" on each row. |
| `SongForm` (modal) | Manual entry of a song the catalog does not have, and editing an entry already in the repertoire. |
| `CorrectionModal` (inside `SongForm`) | Proposes a correction to a catalog field, into the moderation queue. |
| `/admin/moderation` | System admins approve or reject those corrections. |
| `/songs/search` | **A stub.** Eight lines rendering "Global song search coming soon." |

### CRUD, as actually implemented

| | Function | Notes |
|---|---|---|
| Create | `createAndAddSong` | Finds an existing catalog row or inserts one, then adds it to the repertoire. |
| Create | `addSongToRepertoire` | Catalog row already chosen; adds only the repertoire row. |
| Read | `searchGlobalSongs` | `ILIKE '%q%'` on title or artist, `ORDER BY title`, `LIMIT 20`. |
| Update | `updateSong` | Fills only catalog fields that are currently empty. |
| Update | `submitGlobalSongEdit` → `reviewGlobalSongEdit` | The moderated path for changing a field that already has a value. |
| Delete | — | **There is none.** `removeSongFromRepertoire` removes the repertoire row; the catalog row is never deleted by any code path. |

### Findings

**F1.1 — Deduplication ignores the artist.** `createAndAddSong` looks a song up
by `LOWER(title)`, plus album only when an album was given. The unique index
`uq_global_songs_title_album` is `(lower(title), lower(album))` and likewise has
no artist. Two different songs that share a title and carry no album become one
catalog row: the second musician silently gets the first one's artist, key,
cover and links. "Creep", "Yesterday" and every worship standard are one collision
away. This is catalog corruption that no screen can undo, because there is no
delete and the correction queue edits a row rather than splitting it.

**F1.2 — `updateSong` discards edits without saying so.** Every catalog field is
written as `CASE WHEN <empty> THEN $n ELSE <current> END`. A musician who fixes a
misspelled artist sees the form save successfully and the value snap back. The
form does not report which fields were ignored. The code comment still says the
correction mechanism is "not yet built" — `CorrectionModal` builds it, so the
comment is stale, and the form never routes the rejected edit into it.

**F1.3 — `links` is all-or-nothing.** The same guard treats `links` as empty only
when it is exactly `[]`. Once a song has one link, no repertoire owner can ever
add a second through `updateSong`.

**F1.4 — The correction queue never answers the requester.** `rejection_reason`
is written by the admin in `PendingEditCard` and is read back nowhere: no screen
outside `/admin/moderation` reads `global_song_edits` at all. A musician who
submits a correction learns nothing — not that it was approved, not why it was
rejected. A queue with no reply loop trains people to stop using it.

**F1.5 — Search cannot use its indexes.** `idx_global_songs_title` and
`idx_global_songs_artist` are btree, and `ILIKE '%q%'` has a leading wildcard, so
both are dead weight and every search is a sequential scan. There is no ranking
either: `ORDER BY title` puts an exact match below any alphabetically earlier
substring match. `pg_trgm` with a GIN index and a similarity ordering is the
standard fix and needs one migration.

**F1.6 — `/songs/search` is a dead route** that `src/proxy.ts` nevertheless
authenticates and protects. Either it becomes the catalog browse screen the
dashboard search cannot be, or it should be deleted.

**F1.7 — `global_songs` has no `updated_at`.** Every other mutable table carries
one. Without it the offline snapshot cannot tell that a catalog row changed, and
staleness detection has nothing to compare against.

### Architecture notes

- `searchGlobalSongs` interpolates nothing and is parameterised throughout;
  the SQL layer is sound. The problem is the query plan, not the safety.
- `createAndAddSong` runs its lookup, duplicate check and two inserts as four
  separate statements with **no transaction**, unlike `updateSong` and
  `reviewGlobalSongEdit`, which both use `withTransaction`. Two musicians adding
  the same new song at the same moment race on the lookup.
- The action-bundle injection pattern (F21) is applied consistently here:
  `src/app/songPickerActions.ts` and `src/app/page.tsx` both inject, and no
  component imports a server action directly.

### Tasks opened

Parent: **RH-84** — Rework the shared song catalog.

| Task | Covers | Priority |
|---|---|---|
| RH-85 | F1.1 — deduplicate by artist, and wrap the create path in a transaction | critical |
| RH-86 | F1.2 / F1.3 — stop discarding song edits silently | high |
| RH-87 | F1.4 — tell the requester what happened to a correction | medium |
| RH-88 | F1.5 — trigram index and result ranking | medium |
| RH-89 | F1.6 — build or delete `/songs/search` | low |
| RH-90 | F1.7 — add `updated_at` to the catalog table | low |
| RH-91 | Rename `global_songs` → `songs`; split `repertoire` | high |
| RH-92 | Redesign the add-song flow (blocked by RH-86) | medium |
| RH-93 | Model song links as one table with a `provider` | medium |

### Decisions taken (2026-09-23)

- **`global_songs` → `songs`.** The prefix named a contrast that does not exist.
- **Split `repertoire`** into the record the user writes and the aggregate the
  trigger derives. **Do not split `playlists`** — a band playlist is not derived
  from its members'.
- **Drop `contributor_id`.** Written on insert, shipped in every payload
  including the offline snapshot, read by nothing.
- **Add `songs.lyrics`** as the shared wiki lyric; `repertoire.lyrics` stays and
  becomes the per-owner override. Today every musician who adds the same song
  types the lyric again from scratch.
- **One `song_links` table with a `provider` column** for every clickable
  destination, Spotify included — one uniform `{provider, url}` shape, no
  privileged provider. Plus a small `link_providers` lookup carrying label, icon
  and kind. Per-provider tables were rejected: a new platform must cost a row,
  not a migration.
- **Deduplication keys on `songs.isrc`, not on a URL.** A URL is as unique as a
  track id but not as stable: many equal forms per resource (`?si=`,
  `intl-pt/`), one string per platform rather than per recording, and a
  user-deletable row. ISRC arrives free in the Spotify response the search route
  already fetches. `src/lib/spotifyPlaylistSync.ts:103` deduplicates by exact URL
  string equality today; that is the fragility being removed.

### Open decision — the unit of identity (2026-09-23)

How Spotify models it: there is **no canonical song entity**. A track belongs to
exactly one album, so the same recording on the original album, on a greatest-hits
compilation and on a deluxe reissue is three track objects with three ids — sharing
one ISRC. Spotify is album-first and ISRC is the only thread across albums.

The question for this catalog is different, because a musician's repertoire unit is
the **work**, not the release. The test that separates the cases is: *does it change
what you play?*

| Case | Changes what you play | Layer |
|---|---|---|
| Remaster 2015 | no — same performance, different mastering | release |
| Rock Collection (compilation) | no — same recording, different packaging | release |
| Live at Ohio | **yes** — arrangement, key, tempo | version |
| Acoustic / Unplugged / Demo | **yes** | version |

`sanitizeSongTitle` already encodes this line: it strips remaster, deluxe and
anniversary noise and deliberately preserves live, acoustic, unplugged, demo and
cover.

**Proposed** (pending confirmation): identity becomes
`(artist, title, version)` — `version` null for the default studio recording —
and **album leaves the key entirely**. Album, cover and duration stay on the row as
attributes of a representative release. This dissolves both problems at once: a
compilation cannot fork a row because album is not in the key, and a remaster cannot
because the sanitizer strips it.

It also changes the ISRC design: one song accumulates **many** ISRCs (original press,
remaster, compilation), so `songs.isrc` as a single column is wrong. A `song_isrcs`
child table keyed to the song makes deduplication self-improving — every import
records one more code the catalog will recognise next time.

### Empirical check — six Spotify tracks of one Queen song (2026-09-23)

Fetched live from the Spotify API with the project's own credentials.

| # | Title | Album | Type | ISRC | Length |
|---|---|---|---|---|---|
| 1 | I Want **to** Break Free | The Works (1984) | album | `GBUM71106175` | 3:21 |
| 2 | I Want **To** Break Free | Bohemian Rhapsody OST (2018) | album | `GBUM71805978` | 3:43 |
| 3 | … - Single Remix | Greatest Hits II (1991) | compilation | `GBUM71029625` | 4:18 |
| 4 | … - Live At Wembley Stadium / July 1986 | Live at Wembley Stadium (1992) | album | `GBCEE0300040` | 3:34 |
| 5 | … - Single Remix | The Works (Deluxe Edition) | album | `GBUM71029625` | 4:19 |
| 6 | … - Live | Hungarian Rhapsody (Live In Budapest / 1986) | album | `GBUM71205804` | 3:33 |

What the data settles:

- **The compilation case is real and ISRC solves it.** 3 and 5 are one recording
  on two albums — a compilation and a deluxe reissue — and share `GBUM71029625`.
  Their lengths differ by 683 ms, so duration is not a key either.
- **ISRC was right about 1 vs 2 and the title rule was wrong.** They are different
  recordings — different introductions — confirmed by the operator, who knows the
  song. The 22-second gap in the table said so and was wrongly dismissed here as
  mastering noise. Compare the 683 ms between 3 and 5, which really are one
  recording. Length divergence is a signal, not noise.
- On this sample **ISRC is correct in every grouping it makes**, and the sanitized
  title rule over-merges at least once. 4's registrant prefix is `GBCEE` where every
  other is `GBUM`, so re-registration is visible here even though it caused no error.
- **Case matters.** 2 is the only one spelling it "To".
- **Rule A (`createAndAddSong`) produces six rows** — one per album, and would also
  merge any other artist's song of the same name.
- **Rule B (`findOrCreateGlobalSong`) produces four**: {1,2}, {3,5}, {4}, {6}.
  The Spotify import path is already close to right; the manual path is not.
- **`sanitizeSongTitle` does not strip "Single Remix" or "Live …"** — its dash rule
  fires only on remaster/deluxe/anniversary/expanded. Those suffixes survive into
  the title, which is what makes Rule B work by accident.

**Consequence — the ordering inverts.** ISRC is not a second chance behind the title
rule; it is the more reliable signal and the title rule is the fallback that
over-merges. The asymmetry that decides it: an over-merge is unrecoverable here —
there is no delete path for a catalog row and the moderation queue edits a row
rather than splitting one — while an over-split is visible, annoying and fixable.

So:

1. Same ISRC → same song. Merge, definitively.
2. Different ISRC → **never merge automatically**, even when titles match.
3. Neither side has an ISRC (hand-typed) → the sanitized `(artist, title)` triple,
   surfaced as a *suggestion* in the UI rather than a silent merge.

**The controlled-vocabulary `version` enum is dead.** It would have merged 1 and 2
into one "studio" bucket, which is the exact error. A five-value enum cannot hold
"studio 1984" apart from "studio 2018 film edit", and only the ISRC can.

**Album stays out of the key** regardless — 3 and 5 settle that.

Still open, and a question for someone who knows the music: are 4 (Wembley, July
1986) and 6 (Budapest, 1986) one thing to a player or two? ISRC separates them. This
document does not guess.

### ISRC across platforms — measured, not assumed (2026-09-23)

| Platform | Exposes ISRC | Access |
|---|---|---|
| Spotify | yes — `external_ids.isrc` | already wired; arrives free in the search response |
| Deezer | yes — **and accepts it as a lookup key**: `api.deezer.com/2.0/track/isrc:<ISRC>` | public, no auth (verified) |
| Apple Music | yes — `attributes.isrc` | MusicKit; needs a paid Apple Developer account and a signed JWT |
| YouTube Music | no public API | — |
| YouTube | no | a video is not a recording registration — it may be a cover, a fan upload, a lyric video |
| MusicBrainz | yes, **many per recording**, plus the work above it | free, no auth, `User-Agent` required, 1 req/s (verified) |

**The finding that changes the design.** One MusicBrainz recording of this song
carries four ISRCs — `GBCEE0900146`, `GBCEG0100042`, `GBCEG8400014`,
`GBUM71029625` — from three different registrant prefixes. Spotify serves one of
them. So *the same recording can arrive under different codes from different
platforms*, and "different ISRC" is **evidence, not proof**, of a different
recording. Only "same ISRC" is definitive.

Deduplication therefore cannot key on ISRC alone, for three separate reasons:

1. A hand-typed song has no ISRC at all, and a missing code is not a differing one.
2. One recording may carry several codes (above).
3. Only Spotify-imported songs acquire one today.

The rule that survives:

- **Same ISRC → same recording.** Merge, definitively.
- **Different ISRC → evidence of difference**, not proof. Do not merge silently;
  do not split silently either.
- **No ISRC on either side → no signal.** Fall back to the sanitized
  `(artist, title)` pair, surfaced as a suggestion.

**MusicBrainz resolves case 2 and is the better identity.** Its recording MBID is
stable across re-registrations and collects the ISRCs under it, and each recording
links to a *work* — the composition — which is precisely the two-level model this
review kept groping toward. Storing `musicbrainz_recording_id`, resolved by ISRC
lookup at import, is a stronger key than any single code. It is free, needs no
account, and answers the Apple-Music-grade question without the developer fee.

YouTube stays out of identity by nature: there is no registration behind a video.
YouTube entries are links, which is what `song_links` already makes them.

### MusicBrainz coverage probe — the finding that limits all of the above (2026-09-23)

Top search hit per song, `inc=isrcs+work-rels`:

| Artist | Song | Recordings found | ISRCs | Work link |
|---|---|---|---|---|
| Queen | I Want to Break Free | 127 | **4** | yes |
| Hillsong United | Oceans | 29 | 0 | yes |
| Caetano Veloso | Sozinho | 20 | 0 | no |
| Almir Sater | Tocando em Frente | 8 | 0 | no |
| Diante do Trono | A Ele a Glória | 2 | 0 | no |
| Aline Barros | Ressuscita-me | 1 | 0 | no |

**MusicBrainz's ISRC and work coverage is a major-label-catalogue phenomenon.** The
recordings exist for Brazilian and worship repertoire, but carry no ISRCs and mostly
no work link. For the repertoire this app is most likely to hold, the
ISRC → recording → work chain breaks at the first hop: there is no code to look up by.

*Sample caveat: n=6, first search hit only. A different recording of the same song
may carry codes the top hit does not. The direction is clear; the magnitude is not.*

Consequences:

- **The sanitized `(artist, title)` rule is not a fallback — for this app's core
  repertoire it is the primary path.** ISRC-first ordering applies to major-label
  imports and to little else.
- `work_mbid` cannot be resolved via ISRC for most Brazilian material. Resolving it
  by fuzzy title+artist search would reintroduce exactly the unreliability the
  identifier was meant to escape.
- Anything built on MusicBrainz must be **nullable enrichment, resolved lazily after
  insert, never blocking an add and never required for a song to work.**

### Why one recording carries four ISRCs

`GBCEG8400014` (registrant CEG, 1984) · `GBCEG0100042` (same registrant, 2001) ·
`GBCEE0900146` (registrant CEE, 2009) · `GBUM71029625` (Universal Music, ~2010).

Queen's catalogue changed hands over 26 years and each reissue under a new owner got
a fresh code. Multiplicity therefore concentrates in **old catalogue that changed
owners**, not in current releases — platforms importing today all source from the
present rights holder and will usually agree. Note that this review *inferred* that
two platforms could disagree; it did not observe it. Deezer returned the same code
Spotify did.

### UX probe — "Smooth Criminal" (2026-09-23)

Live Spotify search, 20 rows, exactly what the dashboard lists today:

- **5 rows are not the song at all** — Billie Jean, Beat It, Thriller, Bad, and
  Sade's *Smooth Operator*. Spotify pads relevance with the artist's other hits and
  with titles that merely share a prefix.
- **10 rows are Michael Jackson**, nearly all the same recording in different
  packaging: "2012 Remaster" twice, "Radio Edit" twice, "Remastered Radio Edit",
  "Immortal Version".
- **3 rows are Alien Ant Farm** — plain, "2026 Remastered", and "Re-Recorded",
  the last being a genuinely different recording.
- The rest is tribute and remix noise: an Afrobeat cover, a tribute band's live
  take, a house remix, a bossa version, Glee Cast with 2CELLOS.
- **The 1987 studio original is not in the top 20.** The version most people want
  does not appear on the first screen.

**The cover case needs no feature.** Because the key is `(artist, title)`, Alien Ant
Farm's recording is a different catalog row by construction. A user who wants that
version searches, sees two entries — Michael Jackson and Alien Ant Farm — and picks.
Artist *is* the disambiguator. The version machinery exists for choices *within* one
artist (studio vs live), not for covers.

**The real problem is the list.** Grouping by `(artist, title)` — the same key the
data model already uses — turns 20 rows into 2 or 3 cards:

```
Smooth Criminal
Michael Jackson · Bad (1987)              [ + ]
6 versions ⌄

Smooth Criminal
Alien Ant Farm · ANThology (2001)         [ + ]
3 versions ⌄
```

One tap adds the canonical version (earliest release, or the one with no suffix).
The expansion is progressive disclosure for the minority who care. After adding, the
repertoire row shows the artist, which already separates the cover; a version chip
appears only when the version is not the canonical one.

Two further points:

- **Grouping does not fix the 5 wrong rows.** "Billie Jean" would simply become its
  own card. A title-match filter — drop rows whose sanitized title does not contain
  the query — is needed alongside it.
- **In a band, the version is the band's decision, not a personal one.** A band
  repertoire row is one row: if the band plays the Alien Ant Farm arrangement,
  everyone plays it. This is a deliberate asymmetry against lyrics, which RH-83 made
  personally overridable — a musician may keep their own cues, but not their own
  arrangement.

## Catalog — settled design (2026-09-23)

### Search behaviour

**Rank, do not filter.** An earlier note here proposed dropping rows whose sanitized
title does not contain the query. That is wrong: it destroys the typo tolerance that
is the main reason to query Spotify at all — "smoth criminal", "wonderwal". Instead
rank by title similarity to the query and let weak matches fall below the fold.
Grouping already does most of the work: five wrong rows out of twenty become one or
two cards out of four.

### Add flow

1. One search box, debounced, querying the catalog and Spotify in parallel (as today).
2. Results from both sources **merged and grouped by `(artist, title)`**, ranked by
   title similarity. A song already in the catalog and also returned by Spotify is
   **one card**, badged as already catalogued — never two.
3. Each card: cover, title, artist, representative album and year, a primary `[+]`,
   and "N versions ⌄" only when N > 1.
4. `[+]` adds the canonical version — no further decision required.
5. The expansion lists versions with their distinguishing label and duration, each
   with its own `[+]`.
6. Nothing found → "add manually", opening the reduced form: title, artist, album,
   status.

### Schema

```sql
songs (id, title, artist,
       work_mbid null,          -- lazy enrichment, often null
       lyrics null,             -- the shared wiki lyric
       created_at, updated_at)
  unique (lower(artist), lower(title))

song_versions (id, song_id,
       label null,              -- "2012 Remaster", "Live at Wembley"; null = canonical
       is_canonical bool,
       album, cover_url, duration_seconds, standard_key, release_date null,
       mb_recording_id null,
       created_at, updated_at)

song_isrcs (isrc pk, version_id)        -- many codes per version

song_links (id, song_id, version_id null, provider, url, label null,
            position, added_by, created_at)
  unique (song_id, url)
  -- version_id null = applies to the whole song (a Songsterr tab);
  -- set = specific to that recording (a Spotify track)

user_songs (id, user_id, version_id,
            status, tags, personal_key, lyrics null, last_practiced)
  unique (user_id, version_id)

band_songs (id, band_id, version_id,
            status,                     -- derived: MIN across members
            lyrics null)                -- authored by the band (RH-83)
  unique (band_id, version_id)
```

Note a correction to an earlier claim in this review: `band_songs` is **not** a pure
derived aggregate. Its `version_id` and `lyrics` are authored by the band; only
`status` is computed. The split from `user_songs` still holds, because the status
semantics differ fundamentally — read-only and computed on one side, written by the
musician on the other — but it should not be described as a materialised view.

### Write path

Adding one version is one transaction:

1. Resolve or create the `songs` row for `(lower(artist), lower(title))`.
2. Resolve or create the version:
   - **From Spotify** — it carries an ISRC. Look it up in `song_isrcs`; a hit reuses
     the existing version, a miss creates one and records the code.
   - **Hand-typed** — no ISRC, so no identity signal. If the song is new the version
     is created canonical; if the song exists, the UI offers "add as a new version"
     rather than merging silently.
3. Insert the repertoire row for the owner, pointing at the version.

`work_mbid`, `mb_recording_id` and further ISRCs are resolved **after** the insert,
never blocking the add, and stay null when MusicBrainz does not know the song — which
the coverage probe showed is common for Brazilian and worship repertoire.

### Open

- Repertoire rows point at a **version**, so one musician may hold both the studio and
  the live recording as two entries. That is correct — they are different things to
  learn — but the repertoire list should group them under the song rather than show
  two near-identical rows.
- In a band, changing the version moves the row and recomputes the derived status.

### Naming a version in the list

The default version's `label` is **null** in the data. The UI must show something,
and it shows the **album**, never an invented word.

"Canônica" was a schema term leaking into the interface. "Original" replaced it and
was no better: it is an editorial judgment the data does not contain, and it breaks
on a song whose only known recording is a live take.

The two available facts do different jobs, which sets the hierarchy:

| Source | Answers | Example |
|---|---|---|
| Title suffix | *what kind of recording* — the thing that decides whether you play it | "Live at Wembley", "Single Remix" |
| Album | *where it came from* — provenance, often mere packaging | "Number Ones", "Bad 25th Anniversary" |

So: **primary line = the suffix when there is one, the album when there is not**;
sub-line = album · year · duration, or just year · duration when the album has been
promoted. No badge marks the default — the filled `[+]` against the outlined ones
already says which version the collapsed card adds.

This also reads better than the invented word did: "Bad · 1987" tells the musician
which release they are taking, where "Original" told them only that someone decided
it was.

### Provenance of every field in a version row (2026-09-23)

Real Spotify data, `track:"smooth criminal" artist:"michael jackson"`, 13 matching rows:

| Shown | Field | Trustworthy |
|---|---|---|
| Album | `album.name` | yes |
| Duration | `duration_ms` | yes — and informative: the Immortal Version is 1:59 against 4:17 |
| ~~Year~~ | `album.release_date` | **no — dropped** |

`release_date` is the **album's** release, not the recording's. Proof from the same
response: *"Smooth Criminal – 2012 Remaster"* sits on the album `Bad (Remastered)`
whose `release_date` is **1987-08-31**. Showing "Bad · 1987" beside a 2012 remaster is
simply wrong. Live material is worse — from the Queen fetch, `Live at Wembley Stadium`
is dated 1992 for a 1986 concert and `Hungarian Rhapsody (Live In Budapest / 1986)`
is dated 2012 for the same 1986 shows. **A version row shows album · duration, no year.**

The same data settles two more things:

- **The 1987 studio original is not on Spotify as its own track.** Every Michael
  Jackson row is a remaster or an edit. A UI that promises "the original" cannot
  deliver it, which is the third and final reason the invented label was wrong.
- **ISRC collapses the real duplicates.** `USSM11204989` covers "2012 Remaster" on two
  albums; `USSM19909073` covers "Radio Edit" on two more. Thirteen rows become four
  versions once those pairs merge and the karaoke, a cappella, sax and orchestra rows
  — all returned under a search scoped to the artist — are dropped.

*Correction: an earlier version of this mock showed a "Live at Wembley / Bad World
Tour · 1988 · 4:32" row and per-version durations that were never fetched. They were
invented. The mock now carries only values returned by the API.*

---

## Catalog — final model (2026-09-24)

**This section supersedes every earlier design note in this file.** The sections
above are kept as the reasoning trail, including the parts that were wrong.

### Schema

```sql
albums        (id, name, album_type, cover_url, release_date)

songs         (id, title, artist, lyrics)
  unique (lower(artist), lower(title))

song_versions (id, song_id, album_id, label, duration_seconds,
               key, tuning, lyrics, is_default)
  unique (song_id) where is_default

song_links    (id, song_id, version_id null, provider, url, label,
               position, added_by)
  unique (song_id, url)

user_songs    (id, user_id, version_id, status, key, tuning, lyrics,
               tags, last_practiced)
band_songs    (id, band_id, version_id, status, key, tuning, lyrics,
               tags, last_practiced)
```

No `isrc`, `mbid`, `work_mbid` or `spotify_track_id`; all measured and rejected.
No `contributor_id` — written on insert, shipped in every payload, read by nothing.
No `capo` — `tuning` states where the song sounds; how a guitarist gets there is
their own business.

### Inheritance

- **Lyrics**, three levels, each nullable, resolving upward: `songs` → `song_versions`
  (a live take has ad-libs and a different verse order) → the repertoire row.
- **Key and tuning**, two levels: the repertoire row → the version.
- `user_songs` and `band_songs` are two independent cascades against the version.
  A band playing in Bb does not change what you practise alone in C.

### Why `albums` is normalised but the repertoire override is not

The same question, two opposite answers, and the deciding factor is cardinality:

| | Relation | What normalising buys |
|---|---|---|
| `song_versions` → `albums` | many-to-one | twelve versions share one album — real duplication removed |
| `user_songs` → an override table | one-to-one | nothing is duplicated; only a mandatory JOIN is added |

For `albums` the argument is **the update anomaly, not storage or JOIN cost** —
neither is material at this scale. This is a wiki catalog with a moderation queue, so
correcting a cover must touch one row, not every track of that album.

Splitting one-to-one earns its place only for a very wide row whose tail is rarely
read, or for differing access rules. Neither applies, and NULL columns are nearly
free: Postgres stores one bit per column in the row header, not the column width.

### Interaction

- Search merges catalog and Spotify results, groups by `(artist, title)`, ranks by
  title similarity, and **never filters** — a strict title filter destroys the typo
  tolerance that is the reason to query Spotify at all.
- **Collapsed, the card shows one version and its `[+]` adds exactly that version.**
  What is displayed is what is added.
- **Expanded, the card’s `[+]` disappears** and the choice belongs to the list, where
  no version is marked or styled above the others. The list is not filtered by
  `album_type`: three of the four rows in the mock’s Michael Jackson list are
  compilations. `album_type` describes packaging, so it ranks and never excludes.
- Nobody who never expands has to know the list exists.

Mock: https://claude.ai/artifact/NcCNVR5dHa9ipTJWruvYVH

### Choosing the default version

**`album_type = 'album'`, then the earliest `release_date`.** Falls back to the whole
result when no album-type row exists, and is materialised as `song_versions.is_default`.

| Rule | Michael Jackson | Alien Ant Farm |
|---|---|---|
| Most popular | Bad (Remastered) OK | **"Re-Recorded", a 2023 single** WRONG |
| Earliest release | Bad (Remastered) OK | ANThology, 2001 OK |
| album_type + earliest | OK | OK |
| album_type + most popular | OK | OK |

**Popularity alone fails.** Spotify’s `popularity` is recency-weighted, so Alien Ant
Farm’s 2023 re-recording (75) outranks the 2001 original (59). Earliest release also
beats popularity as the tiebreak because it is deterministic — popularity shifts
weekly, so the card’s version would change on its own. `release_date`’s unreliability
helps here: `Bad (Remastered)` carries 1987 despite being a 2012 remaster, sorting it
to the top, which is where it belongs. *Caveat: two songs is a small test.*

### Why the identity problem dissolved

Version choice sits off the critical path, so deduplicating versions only has to be
good enough for a screen most people never open. Getting it slightly wrong costs one
extra row there, not a corrupted catalog. Sanitised title plus a duration tolerance is
enough; the whole ISRC / MusicBrainz apparatus existed only because an earlier draft
put the version choice in front of every user.

Given up: matching against Deezer or Apple later falls back to title. Deferred
deliberately.

### Open for the spec

- `repertoire_tabs.repertoire_id` has no obvious target after the split — a tab may
  belong to a user row or a band row, and both alternatives (two nullable columns with
  a CHECK, or two tab tables) are unattractive.
- `band_songs.last_practiced` must propagate to every member’s `user_songs` row as
  `GREATEST(existing, new)`, so a band rehearsal never erases a more recent solo
  practice. But nothing writes `band_songs.last_practiced` today, so the trigger stays
  inert until a rehearsal action exists.
- Note honestly that the original case for splitting `repertoire` — that a band row is
  a derived aggregate, not a peer — is weaker now that both tables carry identical
  fields. What remains is that the owner columns become NOT NULL and
  `check_repertoire_owner_exclusive` disappears.

### Vocabulary

"Versão", not "gravação" — the operator’s word, used throughout the UI.

---

## 2. Five-stage mastery scale

**Reviewed:** 2026-09-24

### What it is

`song_status` is a Postgres enum — `unknown`, `learning`, `practicing`, `polishing`,
`mastered` — on every `repertoire` row, defaulting to `unknown`. `STATUS_CONFIG` gives
each stage a label and a colour, `STATUS_ORDER` fixes the sequence, and both drive every
surface that shows one.

### Screens and entry points

| Screen | Role |
|---|---|
| `RepertoireDashboard` | Badge per song. In personal context it is a button that advances one stage per tap; in band context it is inert. Also the status filter. |
| `StatusDropdown` (Fast View) | The full list, any stage selectable in any order. |
| `PlaylistSummary` | A stacked bar of the playlist's songs by stage, plus counts. |

### F2.1 — The band's status is computed, not authored

`sync_band_repertoire_on_member_update` (`migrations/0001_initial_schema.sql:278`)
fires `AFTER UPDATE OF status` on any personal row and rewrites the band's row for that
song as `MIN(status)` across every member. `RepertoireDashboard` renders the band badge
read-only to match, captioned "Band status is computed from all members".

The decision taken since is that status is per-owner and nothing aggregates: each
musician holds their own, each band holds its own. So this is a removal — drop the
trigger and the function, and let the band badge become the same control the personal
one is, gated on band admin.

### F2.2 — `MIN` pins a band at `unknown`

The enum's first member is `unknown`, so the minimum across members is `unknown`
whenever *any* member's row is unassessed. Rows are born `unknown`, and adding to a band
playlist creates one for every member. A band adds a song, every member gets an
unassessed row, and the band sits at `unknown` until the last of them acts — one member
who never opens the app holds the whole band's dashboard at zero.

This is the concrete form of the objection that killed the aggregate: it depends on every
member keeping their own status current, and it fails to the least engaged one.

### F2.3 — `unknown` is two things at once

It means "not assessed" and it occupies the bottom rung of an ordered scale. Not
assessing a song is not less mastery than learning it; it is absence of information.
Any aggregate reading it as a rung is wrong, which is why F2.2 happens.

Largely dissolved by F2.1: with nothing aggregating, the ordinal position only affects
sort order and the filter. `PlaylistSummary` still gives it a coloured segment alongside
four real stages, which is a presentation question, not a modelling one.

### F2.4 — Advancing wraps from `mastered` back to `unknown`

`nextStatus` is `STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]`
(`src/lib/statusConfig.ts:22`). On the dashboard the badge is a single tap, labelled
"Click to advance", with no confirmation and no undo. One tap on a mastered song erases
the fact that it was mastered and calls it advancing.

The modulo is what makes a cycling control possible at all, so the fix is a decision
about the control, not the arithmetic: stop at `mastered`, or stop cycling.

### F2.5 — Two controls, different powers

The dashboard cycles forward one stage per tap. The Fast View offers every stage in a
dropdown. Only the second can go back, and it is the one that does not look like an
editor. A musician who over-taps on the dashboard has to open the song to undo it.

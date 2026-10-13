# RH-113 — Make catalog search use an index and rank its results

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


## Scope
`searchSongs` (`src/lib/songs.ts`; formerly `searchGlobalSongs`, table now `songs` after RH-121/RH-122) filters with `title ILIKE '%q%' OR artist ILIKE '%q%'`. A leading wildcard cannot use a btree, so `idx_songs_title` / `idx_songs_artist` are dead weight, and `ORDER BY title` ranks an exact match below any alphabetically earlier substring match.

This task makes the filter index-servable and the order relevance-based. It does not change the result shape (`CatalogSearchResult`, `version_id`, `versions`), the Spotify merge in the picker, or any UI. No mock is needed.

**The cap.** The plan says to "revisit the unpaginated cap of 20". Decision: keep `LIMIT 20` counting songs (not versions), with no pagination. With relevance ordering the 20 returned are the best 20, which is what a type-ahead box needs; pagination would need UI and is out of scope. Record this in the `searchSongs` doc comment.

## Approach
Behavior:
- A new migration (next number after the highest in `migrations/`, currently 0021, so `0022_...`; re-check before writing) runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and creates GIN trigram indexes (`gin_trgm_ops`) on `songs.title` and `songs.artist`. The migration is idempotent (`IF NOT EXISTS`) and the now-useless btree indexes `idx_songs_title` / `idx_songs_artist` are dropped only if nothing else queries those columns by equality or prefix (check; otherwise keep them).
- The match predicate stays substring, case-insensitive on title or artist, so recall does not shrink and the planner can use the GIN indexes. `%`, `_` and `\` in the user's text are escaped so they match literally.
- Ordering, in priority: (1) exact case-insensitive title match, (2) title starts with the query, (3) greatest of `similarity(title, q)` and `similarity(artist, q)` descending, (4) title ascending, then id as a stable tie-break.
- Queries shorter than three characters yield no trigrams; they must still return correct results (a scan fallback is acceptable and expected).
- Blank query still returns `[]` without touching the DB. `LIMIT 20` and the per-song `versions` aggregate are unchanged.

Files touched:
- `migrations/0022_catalog_search_trgm.sql` — new: extension, two GIN indexes, optional btree drop.
- `src/lib/songs.ts` — `searchSongs` predicate escaping, ORDER BY, doc comment on the cap decision.
- `src/lib/__tests__/songs.test.ts` — unit assertions on the query text/params (escaped pattern, ranking terms).
- `src/lib/__tests__/catalogVersions.db.test.ts` (or a sibling `*.db.test.ts`) — real-Postgres ranking and index tests.
- `AGENTS.md` / `docs/use-cases.md` — one line in *Search for a song* if either describes the ordering.

Test criteria:
- DB test: with songs titled "Love", "Glove Story", "A Love Supreme" (and an artist-only match), searching "love" returns "Love" first and "Love"-prefixed before mid-string matches; an artist-only match is still returned.
- DB test: `EXPLAIN` of the search predicate on a table seeded with enough rows (with `SET enable_seqscan = off` if needed to be deterministic) references the trigram index, and `pg_indexes` lists both GIN indexes.
- DB test: a query of `50%` or `a_b` matches only literal text.
- Migration applies on a fresh DB and re-applies cleanly through `scripts/migrate.mjs`; existing migration-guard tests stay green.

## Expected Results
- [ ] ER1: Migration `0022_*.sql` (number re-checked against `migrations/`) applies cleanly and `pg_indexes` shows GIN `gin_trgm_ops` indexes on `songs.title` and `songs.artist`.
- [ ] ER2: A DB test shows the title/artist substring predicate planning onto a trigram index rather than a sequential scan.
- [ ] ER3: Searching "love" returns matches ordered exact title first, then title-prefix, then other matches, with an artist-only match still included.
- [ ] ER4: A query containing `%` or `_` matches those characters literally.
- [ ] ER5: A one- or two-character query returns the correct matches.
- [ ] ER6: A blank query returns `[]` without a DB call.
- [ ] ER7: `searchSongs` returns at most 20 songs.
- [ ] ER8: Each `searchSongs` result keeps its `version_id` and `versions` fields unchanged.

## Out of Scope
Pagination or a larger cap, typo tolerance beyond the substring filter (a similarity-threshold filter would narrow nothing but also add nothing here), Spotify result ranking, the picker UI, deleting `/songs/search` (separate plan item).

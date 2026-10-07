/**
 * RH-136 — the one place `song_links` is read from, and the one place a links
 * write is made safe before any statement sees it.
 *
 * A plain library module, with no server-action directive at the top and not
 * under `src/app/actions/`. Files there publish every export as a Server
 * Action, so
 * a helper taking a caller-supplied id would become a callable endpoint that
 * never passes `getRequiredUserId`. Nothing here takes a `userId`, and nothing
 * here issues a statement — the four writers do that themselves, each with its
 * own conflict policy.
 *
 * Why the read lives here rather than in each reader: three copies of a SQL
 * string drift silently and type-check while drifting, which is the same reason
 * `playlistSql.ts` exists at all. `playlistSql.ts`, `ownerSongRows.ts` and
 * `moderation.ts` all import {@link songLinksJson}.
 */

import type { SongLink } from '@/types/database'

/**
 * A song's links as a json array, correlated on `<alias>.id`, in the **canonical
 * read order** — `ORDER BY position, created_at, id`, with no exception
 * anywhere.
 *
 * `COALESCE(..., '[]'::json)` is what makes a link-less song answer an empty
 * array rather than null: `json_agg` over no rows is null, and every reader of
 * `Song.links` treats it as an array.
 *
 * `position` carries the array ordinality the column used to express, so the
 * order a musician sees is the order they saw before this table existed. Order
 * by `(created_at, id)` alone would scramble any two rows written by the same
 * statement: they share one `now()` and the tie breaks on a random uuid.
 *
 * `alias` is the `songs` alias of the calling query, chosen by the caller's own
 * SQL and never by a request.
 */
export function songLinksJson(alias: string): string {
  return `COALESCE((
             SELECT json_agg(json_build_object(
                      'label', sl.label,
                      'url', sl.url,
                      'provider', sl.provider
                    ) ORDER BY sl.position, sl.created_at, sl.id)
               FROM song_links sl
              WHERE sl.song_id = ${alias}.id
           ), '[]'::json)`
}

/**
 * Layer 1 of the duplicate-url policy: the first occurrence of each `url` wins
 * and the rest are dropped.
 *
 * `UNIQUE (song_id, url)` turns a duplicated url from a harmless extra card
 * into an aborted transaction, and a duplicate is reachable through no misuse at
 * all — `SongLinksEditor` has no duplicate check, `updateSongLinksAction` has
 * none, `usableLinks` does not dedupe and neither does `parseLinks`. Only the
 * Fast View add-link form checks, client-side.
 *
 * Two measured Postgres facts make this mandatory rather than defensive, both
 * against a multi-row insert carrying the same `(song_id, url)` twice: plain, it
 * raises `23505`; with `ON CONFLICT ... DO UPDATE`, `21000 ON CONFLICT DO UPDATE
 * command cannot affect row a second time`. There is no per-row recovery
 * available either — `transactionGuard.test.ts` bans transaction control through
 * `query()` under `src/`, so no savepoint can catch a conflict and continue. The
 * statement itself has to be safe, and the blast radius of its not being safe is
 * not local: `applyCatalogFill` runs on `updateSong`'s shared transaction, so an
 * aborted statement takes the owner-row write with it and the musician loses the
 * whole song edit.
 *
 * **First occurrence wins** is the same rule the migration's backfill and the
 * bridge trigger apply in SQL (`DISTINCT ON (song_id, url)` ordered by
 * ordinality), so the three can never disagree. Url equality is byte equality —
 * exactly the comparison `UNIQUE (song_id, url)` makes: no trimming, no case
 * folding, no trailing-slash normalisation.
 *
 * The survivors' array order **is** their `position`: see
 * {@link songLinkInsertRows}, which numbers them from 1, so the collapse leaves
 * no gap.
 */
export function dedupeLinksByUrl(links: SongLink[]): SongLink[] {
  const seen = new Set<string>()
  const kept: SongLink[] = []
  for (const link of links) {
    if (seen.has(link.url)) continue
    seen.add(link.url)
    kept.push(link)
  }
  return kept
}

/** The `VALUES` body and bound parameters of one links insert. */
export interface SongLinkInsertRows {
  /** `($1, $2, $3, 1), ($1, $4, $5, 2)` … — interpolate after `VALUES`. */
  values: string
  /** `[songId, url1, label1, url2, label2, …]`, in that order. */
  params: string[]
  /** Survivor count. **Zero means the caller must issue no statement at all.** */
  count: number
}

/**
 * Numbers a **already-deduplicated** link array into insertable rows.
 *
 * `position` is the 1-based index over the survivors, not an offset from the
 * existing rows' `max(position)`. That is deliberate: the bridge trigger leaves
 * gaps on purpose (`max + ordinality`, so a third link on a two-row song lands
 * at 5), and numbering from an existing maximum would preserve those gaps
 * forever and make the submitted array's order unrecoverable from the table.
 * Renumbering from 1 is also precisely today's semantics, since the
 * whole-array column rewrite this replaces rewrote the whole array and its
 * order. The two order-authoritative writers then re-assert that numbering with
 * `ON CONFLICT ... DO UPDATE SET label = EXCLUDED.label, position =
 * EXCLUDED.position`; without the `position` clause a survivor keeps whatever
 * number an earlier statement left it and the new row lands **tied** with it.
 *
 * Pass the output of {@link dedupeLinksByUrl}: this function does not dedupe,
 * because every caller has to name the helper itself for the duplicate policy to
 * be greppable per writer.
 *
 * A missing label is stored as the empty string, which is what the column
 * declares and what the UI already reads as "show the url".
 */
export function songLinkInsertRows(songId: string, links: SongLink[]): SongLinkInsertRows {
  const values = links.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}, ${i + 1})`).join(', ')
  const params: string[] = [songId]
  for (const link of links) {
    params.push(link.url, link.label ?? '')
  }
  return { values, params, count: links.length }
}

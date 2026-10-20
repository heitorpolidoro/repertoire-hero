/**
 * RH-120 — the one album a screen shows for a version, spelled once.
 *
 * A version is one recording with many releases (`version_albums`), but every
 * existing read projects exactly one album per version: the catalog search
 * results, the owner rows, the representative-version ordering. This module is
 * the single place that picks it.
 *
 * The rule: `album_type = 'album'` first, then the earliest
 * `albums.release_date`, then the earliest link `created_at`, then
 * `albums.id`; nulls last at every level. It is a sort, never a stored column.
 *
 * The join is a `LEFT JOIN LATERAL ... ON true`, so a version with no link
 * resolves to no album and is never dropped — the guard
 * `ownerSongsGuards.test.ts` pins.
 *
 * Aliases are supplied by the caller and are SQL identifiers written by this
 * codebase, never by a user.
 */

/** The ordering of one version's links, over the aliases of the join it sits in. */
function primaryAlbumOrder(album: string, link: string): string {
  return (
    `(${album}.album_type = 'album') DESC NULLS LAST, ` +
    `${album}.release_date ASC NULLS LAST, ` +
    `${link}.created_at ASC, ${album}.id ASC`
  )
}

/**
 * `LEFT JOIN LATERAL` exposing the primary album of `version` (an alias in the
 * enclosing `FROM`) under the alias `album`, with every `albums` column.
 */
export function primaryAlbumJoin(version: string, album: string): string {
  return (
    `LEFT JOIN LATERAL (` +
    `SELECT pal.* FROM version_albums pvl JOIN albums pal ON pal.id = pvl.album_id ` +
    `WHERE pvl.version_id = ${version}.id ` +
    `ORDER BY ${primaryAlbumOrder('pal', 'pvl')} LIMIT 1` +
    `) ${album} ON true`
  )
}

import { query, withTransaction, type Queryable } from '@/lib/db'
import { parseSongEditPayload } from '@/lib/songEditPayload'
import { logger } from '@/lib/logger'
import { dedupeLinksByUrl, songLinkInsertRows, songLinksJson } from '@/lib/songLinksSql'
import type { SongEdit, SongLink } from '@/types/database'

/**
 * The `links` entry of a parsed payload, or `undefined` when the edit proposes
 * no links at all — which is **not** the same as proposing an empty array, the
 * "remove every link" instruction ER14(c) requires to work.
 *
 * A file-local reader rather than two lines inside `reviewSongEdit`, because
 * that function measures 14 against a base `complexity` ceiling of 15 and
 * `eslint.config.mjs`'s override list is shrink-only (ER24): a ternary spent
 * here would have nowhere to go.
 *
 * Narrowed by `Array.isArray` rather than by an `as SongLink[]` cast:
 * `parseSongEditPayload` does guarantee the shape today, but a cast would
 * survive that guarantee changing and this value is handed straight to a
 * writer.
 */
function approvedLinksOf(
  entries: Array<[string, string | number | null | SongLink[]]>,
): SongLink[] | undefined {
  const entry = entries.find(([column]) => column === 'links')?.[1]
  return Array.isArray(entry) ? entry : undefined
}

/**
 * An approved links array, applied to `song_links` as a **replace-set**.
 *
 * An approved correction is authoritative over the whole set, labels and order
 * included, so this is `DELETE` then upsert rather than a fill:
 *
 *  - the `DELETE` runs first, which is what lets a surviving url keep its
 *    `song_links.id`; an approved **empty** array deletes every row, since
 *    `url <> ALL('{}')` holds for all of them;
 *  - the insert's conflict policy re-asserts both the label and the position.
 *    That position clause is the
 *    whole reason this writer has authority over order: a correction that keeps
 *    every url and only moves two of them produces a `DELETE` that removes
 *    nothing and an insert that conflicts on every row, so with `DO UPDATE SET
 *    label` alone *nothing at all* is written and the approved reorder is
 *    discarded without an error while the edit's status still flips to
 *    `approved`.
 *
 * `dedupeLinksByUrl` is what keeps that `DO UPDATE` off `21000`; `parseLinks`
 * admits a duplicated url and does not supply it.
 */
async function applyApprovedSongLinks(
  client: Queryable,
  songId: string,
  links: SongLink[],
): Promise<void> {
  const deduped = dedupeLinksByUrl(links)
  await client.query<never>(
    'DELETE FROM song_links WHERE song_id = $1 AND url <> ALL($2::text[])',
    [songId, deduped.map((l) => l.url)],
  )
  const rows = songLinkInsertRows(songId, deduped)
  if (rows.count === 0) return
  await client.query<never>(
    `INSERT INTO song_links (song_id, url, label, position)
     VALUES ${rows.values}
     ON CONFLICT (song_id, url) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position`,
    rows.params,
  )
}

export async function submitSongEdit(
  userId: string,
  songId: string,
  data: Record<string, unknown>
): Promise<SongEdit> {
  // `global_song_edits` keeps its name on purpose. RH-121 renamed the catalog
  // table to `songs` and moved this module's TypeScript vocabulary with it
  // (`SongEdit`, `submitSongEdit`), but not the queue table: the plan replaces
  // it wholesale with a differently shaped `catalog_suggestions` — one row per
  // proposed field instead of a jsonb of several — so renaming it to
  // `song_edits` now would be churn that part deletes. Until then the mismatch
  // between `SongEdit` and `global_song_edits` is a decision, not an oversight.
  const sql = `
    INSERT INTO global_song_edits (song_id, requested_by, proposed_data, status)
    VALUES ($1, $2, $3, 'pending')
    RETURNING *
  `
  // Outside the wrapper (convention L1a): the UI shows this message verbatim.
  // Validation only — `proposed_data` is stored verbatim so the moderation queue
  // keeps the requester's `reason` (see src/app/admin/moderation/page.tsx).
  parseSongEditPayload(data)
  try {
    const res = await query<SongEdit>(sql, [songId, userId, JSON.stringify(data)])
    return res.rows[0]
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to submit global song edit', err, { userId, songId })
    throw new Error(`Failed to submit global song edit: ${err.message}`)
  }
}

export async function checkSystemAdmin(userId: string): Promise<void> {
  const sql = 'SELECT is_system_admin FROM profiles WHERE id = $1'
  const res = await query<{ is_system_admin: boolean }>(sql, [userId])
  if (res.rowCount === 0 || !res.rows[0]?.is_system_admin) {
    throw new Error('Access denied: User is not a system admin')
  }
}

export async function getPendingSongEdits(
  adminUserId: string
): Promise<SongEdit[]> {
  try {
    await checkSystemAdmin(adminUserId)

    const sql = `
      SELECT e.*,
             json_build_object(
               'id', s.id,
               'title', s.title,
               'artist', s.artist,
               'album', s.album,
               'standard_key', s.standard_key,
               'cover_url', s.cover_url,
               'duration_seconds', s.duration_seconds,
               'links', ${songLinksJson('s')},
               'created_at', s.created_at
             ) as song,
             json_build_object(
               'id', p.id,
               'email', p.email,
               'full_name', p.full_name,
               'avatar_url', p.avatar_url,
               'instruments', p.instruments,
               'primary_instrument', p.primary_instrument,
               'is_system_admin', p.is_system_admin
             ) as requester
      FROM global_song_edits e
      JOIN songs s ON e.song_id = s.id
      JOIN profiles p ON e.requested_by = p.id
      WHERE e.status = 'pending'
      ORDER BY e.created_at ASC
    `
    const res = await query<SongEdit>(sql, [])
    return res.rows
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (err.message.startsWith('Access denied')) {
      throw err
    }
    logger.error('Failed to fetch pending global song edits', err, { adminUserId })
    throw new Error(`Failed to fetch pending global song edits: ${err.message}`)
  }
}

export async function reviewSongEdit(
  adminUserId: string,
  editId: string,
  action: 'approve' | 'reject',
  reason?: string
): Promise<SongEdit> {
  try {
    await checkSystemAdmin(adminUserId)

    const editRes = await query<SongEdit>(
      'SELECT * FROM global_song_edits WHERE id = $1',
      [editId]
    )

    if (editRes.rowCount === 0) {
      throw new Error('Global song edit not found')
    }

    const edit = editRes.rows[0]

    if (edit.status !== 'pending') {
      throw new Error('Edit request is already reviewed')
    }

    if (action === 'reject') {
      const updateSql = `
        UPDATE global_song_edits
        SET status = 'rejected', reviewed_by = $1, rejection_reason = $2, updated_at = now()
        WHERE id = $3
        RETURNING *
      `
      const res = await query<SongEdit>(updateSql, [adminUserId, reason || null, editId])
      return res.rows[0]
    }

    // Action: approve. The row was written by whoever submitted it, so its
    // fields are narrowed before any of them reaches the catalog UPDATE.
    const payload = parseSongEditPayload(edit.proposed_data)
    // The payload only ever holds the seven `songs` column names, in column
    // order, so interpolating a key as a SQL identifier is safe here.
    const entries: Array<[string, string | number | null | SongLink[]]> = Object.entries(payload)
    // `links` is partitioned out **before** the loop, not after: the loop
    // numbers each placeholder from `values.length + 1`, so removing a clause
    // afterwards would mean renumbering every surviving one.
    const approvedLinks = approvedLinksOf(entries)
    const fields = entries.filter(([column]) => column !== 'links')
    const setClauses: string[] = []
    const values: (string | number | null)[] = []

    for (const [column, value] of fields) {
      setClauses.push(`${column} = $${values.length + 1}`)
      values.push(Array.isArray(value) ? JSON.stringify(value) : value)
    }

    // Applying the edit and marking it reviewed are one unit: a catalog rewrite
    // whose edit stays `pending` gets applied twice by the next admin.
    return await withTransaction(async (client) => {
      values.push(edit.song_id)
      // The timestamp clause is appended to the proposed-column clauses
      // **inline inside the template's interpolation**, so the join supplies the
      // comma. That is what makes an edit proposing only `links` — whose clause
      // is partitioned out above, leaving none — produce valid SQL instead of
      // an empty SET list and a 42601. The literal must stay between the
      // statement's verb and its WHERE in the *source text*, because
      // `catalogTimestampGuard`'s scan is textual, not a SQL parse.
      //
      // `setClauses` itself is still only the narrowed set of columns a
      // submitted edit may propose, and `updated_at` is still not one of them
      // (RH-101) — what changed is where the clause is concatenated, not who may
      // propose it.
      const updateSongSql = `UPDATE songs SET ${[...setClauses, 'updated_at = now()'].join(', ')} WHERE id = $${values.length}`
      await client.query<never>(updateSongSql, values)

      // `!== undefined`, not a truthiness test: an **approved empty array** is
      // a real instruction — "remove every link" — and `[]` being truthy in
      // JavaScript is too invisible a thing for that case to depend on.
      if (approvedLinks !== undefined) {
        await applyApprovedSongLinks(client, edit.song_id, approvedLinks)
      }

      const updateEditSql = `
        UPDATE global_song_edits
        SET status = 'approved', reviewed_by = $1, updated_at = now()
        WHERE id = $2
        RETURNING *
      `
      const res = await client.query<SongEdit>(updateEditSql, [adminUserId, editId])
      return res.rows[0]
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    if (
      err.message.startsWith('Access denied') ||
      err.message.startsWith('Invalid global song edit') ||
      err.message === 'Global song edit not found' ||
      err.message === 'Edit request is already reviewed'
    ) {
      throw err
    }
    logger.error('Failed to review global song edit', err, {
      adminUserId,
      editId,
      action,
    })
    throw new Error(`Failed to review global song edit: ${err.message}`)
  }
}

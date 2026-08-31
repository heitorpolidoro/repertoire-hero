'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { query } from '@/lib/db'
import { put, del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import type { RepertoireTab, Stroke, TabAnnotations } from '@/types/database'

export type { Stroke, TabAnnotations }

async function checkAccess(userId: string, repertoireId: string) {
  const sql = `
    SELECT r.id 
    FROM repertoire r
    WHERE r.id = $1 AND (
      r.user_id = $2 OR 
      r.band_id IN (
        SELECT band_id FROM band_members WHERE user_id = $2
      )
    )
  `
  const { rows } = await query(sql, [repertoireId, userId])
  if (rows.length === 0) {
    throw new Error('Access denied')
  }
}

export async function uploadTabAction(formData: FormData): Promise<{ data?: RepertoireTab; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const repertoireId = formData.get('repertoireId') as string
    const title = formData.get('title') as string
    const file = formData.get('file') as File | null

    if (!repertoireId || !title || !file) {
      return { error: 'Missing required fields' }
    }

    await checkAccess(userId, repertoireId)

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return { error: 'File size exceeds the 10MB limit' }
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Validate file: file.type is unreliable for files picked via Android's
    // Storage Access Framework (e.g. the Google Drive app), which can hand
    // Chrome an empty or generic MIME type for a genuine PDF. Sniff the PDF
    // magic bytes instead of trusting file.type alone.
    const isPdf = file.type === 'application/pdf' || buffer.subarray(0, 5).toString('latin1') === '%PDF-'
    if (!isPdf) {
      return { error: 'Only PDF files are allowed' }
    }

    // Upload to Vercel Blob Storage
    // We use the original file name (sanitized) so that the download/view link retains a legible name.
    // Vercel Blob automatically appends a random unique suffix to prevent collisions.
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    const filePath = `repertoire-tabs/${repertoireId}/${cleanFileName}`

    const blob = await put(filePath, buffer, {
      access: 'public',
      contentType: 'application/pdf',
    })

    const publicUrl = blob.url

    // Save to Database
    const { rows } = await query(
      `INSERT INTO repertoire_tabs (repertoire_id, title, file_url)
       VALUES ($1, $2, $3)
       RETURNING id, repertoire_id, title, file_url, created_at::text as created_at`,
      [repertoireId, title, publicUrl]
    )

    revalidatePath('/')
    return { data: rows[0] as RepertoireTab }
  } catch (err: any) {
    return { error: err.message || 'An unexpected error occurred during upload' }
  }
}

export async function deleteTabAction(tabId: string, repertoireId: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    await checkAccess(userId, repertoireId)

    // Get tab details to retrieve the file URL
    const { rows: tabRows } = await query(
      'SELECT file_url FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
      [tabId, repertoireId]
    )

    if (tabRows.length === 0) {
      return { error: 'Tab not found' }
    }

    const fileUrl = tabRows[0].file_url
    
    // Delete physical file from Vercel Blob directly using its public URL
    await del(fileUrl)

    // Delete from DB
    await query(
      'DELETE FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
      [tabId, repertoireId]
    )

    revalidatePath('/')
    return { success: true }
  } catch (err: any) {
    return { error: err.message || 'Failed to delete tablatura' }
  }
}

export async function getTabAnnotationsAction(
  tabId: string,
  repertoireId: string,
): Promise<{ data?: TabAnnotations; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    await checkAccess(userId, repertoireId)
    const { rows } = await query(
      'SELECT annotations FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
      [tabId, repertoireId]
    )
    if (rows.length === 0) return { error: 'Tab not found' }
    return { data: rows[0].annotations as TabAnnotations }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to load annotations' }
  }
}

export async function saveTabAnnotationsAction(
  tabId: string,
  repertoireId: string,
  pageNumber: number,
  strokes: Stroke[],
): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    await checkAccess(userId, repertoireId)
    // Defensive validation: pageNumber gets folded directly into the
    // jsonb_set path below, so reject anything that isn't a positive
    // integer before it reaches SQL (avoids an opaque Postgres error on
    // bad input, e.g. a stale/tampered client sending pageNumber: 0 or NaN).
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return { error: 'Invalid page number' }
    }
    // jsonb_set writes/overwrites only this page's key, leaving every
    // other page's strokes in the same row untouched.
    // RETURNING id is required so the affected row count can be checked
    // below — without it a non-matching tabId/repertoireId pair would
    // silently no-op and this action would still report { success: true },
    // masking a not-found case.
    const { rows } = await query(
      `UPDATE repertoire_tabs
       SET annotations = jsonb_set(annotations, $3, $4::jsonb, true)
       WHERE id = $1 AND repertoire_id = $2
       RETURNING id`,
      [tabId, repertoireId, `{${pageNumber}}`, JSON.stringify(strokes)]
    )
    if (rows.length === 0) return { error: 'Tab not found' }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to save annotations' }
  }
}

export async function getTabsAction(repertoireId: string) {
  const userId = await getRequiredUserId()
  await checkAccess(userId, repertoireId)

  const { rows } = await query(
    `SELECT id, repertoire_id, title, file_url, created_at::text as created_at
     FROM repertoire_tabs
     WHERE repertoire_id = $1
     ORDER BY created_at DESC`,
    [repertoireId]
  )

  return rows as RepertoireTab[]
}

'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { query } from '@/lib/db'
import { put, del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import type { RepertoireTab } from '@/types/database'

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

    // Validate file
    if (file.type !== 'application/pdf') {
      return { error: 'Only PDF files are allowed' }
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return { error: 'File size exceeds the 10MB limit' }
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Vercel Blob Storage
    const fileId = crypto.randomUUID()
    const filePath = `repertoire-tabs/${repertoireId}/${fileId}.pdf`

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

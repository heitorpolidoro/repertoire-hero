'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { query } from '@/lib/db'
import { supabaseAdmin } from '@/lib/supabase'
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

export async function uploadTabAction(formData: FormData) {
  const userId = await getRequiredUserId()
  const repertoireId = formData.get('repertoireId') as string
  const title = formData.get('title') as string
  const file = formData.get('file') as File | null

  if (!repertoireId || !title || !file) {
    throw new Error('Missing required fields')
  }

  await checkAccess(userId, repertoireId)

  // Validate file
  if (file.type !== 'application/pdf') {
    throw new Error('Only PDF files are allowed')
  }

  // Max 10MB
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('File size exceeds the 10MB limit')
  }

  // Ensure bucket exists
  try {
    await supabaseAdmin.storage.createBucket('tabs', { public: true })
  } catch {
    // Bucket might already exist, safe to ignore
  }

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Upload to Supabase Storage
  const fileId = crypto.randomUUID()
  const filePath = `${repertoireId}/${fileId}.pdf`

  const { error: uploadError } = await supabaseAdmin.storage
    .from('tabs')
    .upload(filePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`)
  }

  // Get public URL
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('tabs')
    .getPublicUrl(filePath)

  // Save to Database
  const { rows } = await query(
    `INSERT INTO repertoire_tabs (repertoire_id, title, file_url)
     VALUES ($1, $2, $3)
     RETURNING id, repertoire_id, title, file_url, created_at::text as created_at`,
    [repertoireId, title, publicUrl]
  )

  revalidatePath('/')
  return rows[0] as RepertoireTab
}

export async function deleteTabAction(tabId: string, repertoireId: string) {
  const userId = await getRequiredUserId()
  await checkAccess(userId, repertoireId)

  // Get tab details to retrieve the file URL
  const { rows: tabRows } = await query(
    'SELECT file_url FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
    [tabId, repertoireId]
  )

  if (tabRows.length === 0) {
    throw new Error('Tab not found')
  }

  const fileUrl = tabRows[0].file_url
  
  // Extract path from fileUrl. The URL looks like:
  // https://[project-ref].supabase.co/storage/v1/object/public/tabs/[repertoireId]/[fileId].pdf
  // The path in bucket is [repertoireId]/[fileId].pdf
  const bucketMarker = '/storage/v1/object/public/tabs/'
  const idx = fileUrl.indexOf(bucketMarker)
  if (idx !== -1) {
    const filePath = fileUrl.substring(idx + bucketMarker.length)
    // Delete physical file
    await supabaseAdmin.storage.from('tabs').remove([filePath])
  }

  // Delete from DB
  await query(
    'DELETE FROM repertoire_tabs WHERE id = $1 AND repertoire_id = $2',
    [tabId, repertoireId]
  )

  revalidatePath('/')
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

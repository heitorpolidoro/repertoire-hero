'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { assertRepertoireAccess } from '@/lib/songs'
import {
  createTab,
  getTabFileUrl,
  deleteTab,
  getTabAnnotations,
  saveTabAnnotations,
  listTabs,
} from '@/lib/tabs'
import { put, del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import type { RepertoireTab, Stroke, TabAnnotations } from '@/types/database'

export type { Stroke, TabAnnotations }

export async function uploadTabAction(formData: FormData): Promise<{ data?: RepertoireTab; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const repertoireId = formData.get('repertoireId') as string
    const title = formData.get('title') as string
    const file = formData.get('file') as File | null

    if (!repertoireId || !title || !file) {
      return { error: 'Missing required fields' }
    }

    // Asserted here as well as inside `createTab`: without it the blob upload
    // below would happen before the caller is known to be entitled to it.
    await assertRepertoireAccess(repertoireId, userId)

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

    const tab = await createTab(repertoireId, userId, title, blob.url)

    revalidatePath('/')
    return { data: tab }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'An unexpected error occurred during upload' }
  }
}

export async function deleteTabAction(tabId: string, repertoireId: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    // Same reason as the upload: the blob deletion below must not precede the
    // authorization check.
    await assertRepertoireAccess(repertoireId, userId)

    const fileUrl = await getTabFileUrl(tabId, repertoireId, userId)
    if (fileUrl === null) {
      return { error: 'Tab not found' }
    }

    // Delete physical file from Vercel Blob directly using its public URL
    await del(fileUrl)

    await deleteTab(tabId, repertoireId, userId)

    revalidatePath('/')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to delete tablatura' }
  }
}

export async function getTabAnnotationsAction(
  tabId: string,
  repertoireId: string,
): Promise<{ data?: TabAnnotations; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const annotations = await getTabAnnotations(tabId, repertoireId, userId)
    if (annotations === null) return { error: 'Tab not found' }
    return { data: annotations }
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
    const saved = await saveTabAnnotations(tabId, repertoireId, userId, pageNumber, strokes)
    if (!saved) return { error: 'Tab not found' }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to save annotations' }
  }
}

export async function getTabsAction(repertoireId: string) {
  const userId = await getRequiredUserId()
  return listTabs(repertoireId, userId)
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repertoire, SongFile } from '@/types/database'
import type { ToastTone } from '@/lib/uiTones'
import { defaultTitleFromFileName, tabUploadTitle } from '@/lib/tabLibrary'
import { validateAudioFile, type AudioLibraryController } from '@/lib/audioLibrary'

/** The audio Server Actions, injected so `src/hooks` never imports the App Router tree (F21). */
export interface AudioLibraryActions {
  getAudio: (songId: string) => Promise<SongFile[]>
  uploadAudio: (formData: FormData) => Promise<{ data?: SongFile; entry?: Repertoire; error?: string }>
  deleteAudio: (fileId: string) => Promise<{ success?: boolean; error?: string }>
}

export interface UseAudioLibraryOptions {
  songId: string | null
  actions: AudioLibraryActions
  onPersonalEntryCreated: (entry: Repertoire) => void
  notify: (message: string, tone: ToastTone) => void
}

/**
 * Fast View's audio controller: the song's audio list, the upload form and the
 * delete. Audio never enters the song window cache or the offline snapshot, so
 * this makes its own fetch; offline that fetch fails and the list stays empty
 * (S1: the section is optional chrome).
 */
export function useAudioLibrary({
  songId,
  actions,
  onPersonalEntryCreated,
  notify,
}: UseAudioLibraryOptions): AudioLibraryController {
  const [files, setFiles] = useState<SongFile[]>([])
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!songId) return
    let cancelled = false
    actions
      .getAudio(songId)
      .then((loaded) => {
        if (!cancelled) setFiles(loaded)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [actions, songId])

  const pickFile = useCallback((file: File | null) => {
    setUploadFile(file)
    if (!file) return
    setUploadTitle((current) => (current.trim() ? current : defaultTitleFromFileName(file.name)))
  }, [])

  const submitUpload = useCallback(() => {
    const file = uploadFile
    if (!file || !songId) return

    const validation = validateAudioFile(file)
    if (!validation.ok) {
      setUploadError(validation.message)
      return
    }

    const run = async () => {
      try {
        setUploading(true)
        setUploadError(null)
        const formData = new FormData()
        formData.append('songId', songId)
        formData.append('title', tabUploadTitle(uploadTitle, file.name))
        formData.append('file', file)

        const res = await actions.uploadAudio(formData)
        if (res.error) {
          setUploadError(res.error)
          return
        }
        if (res.entry) onPersonalEntryCreated(res.entry)
        if (res.data) {
          const uploaded = res.data
          setFiles((prev) => [uploaded, ...prev])
        }
        setUploadTitle('')
        setUploadFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } catch (err) {
        const message = err instanceof Error ? err.message : undefined
        setUploadError(message || 'Failed to upload audio')
      } finally {
        setUploading(false)
      }
    }
    void run()
  }, [actions, onPersonalEntryCreated, songId, uploadFile, uploadTitle])

  const deleteFile = useCallback(
    async (fileId: string) => {
      try {
        const res = await actions.deleteAudio(fileId)
        if (res.error) {
          notify(res.error, 'error')
          return
        }
        setFiles((prev) => prev.filter((file) => file.id !== fileId))
        notify('File deleted.', 'info')
      } catch {
        notify('Failed to delete file', 'error')
      }
    },
    [actions, notify],
  )

  return {
    files,
    uploadTitle,
    uploadFile,
    uploading,
    uploadError,
    fileInputRef,
    setUploadTitle,
    pickFile,
    submitUpload,
    deleteFile,
  }
}

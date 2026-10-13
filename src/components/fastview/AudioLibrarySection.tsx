'use client'

import type { Repertoire } from '@/types/database'
import type { ToastTone } from '@/lib/uiTones'
import { useAudioLibrary, type AudioLibraryActions } from '@/hooks/useAudioLibrary'
import { AudioSection } from './AudioSection'

export interface AudioLibrarySectionProps {
  songId: string | null
  /** Injected by the page (F21); module-level so its identity is stable. */
  actions: AudioLibraryActions
  onPersonalEntryCreated: (entry: Repertoire) => void
  notify: (message: string, tone: ToastTone) => void
  offline: boolean
  readOnly: boolean
}

/**
 * The audio controller wired to its section (RH-162). It exists so the Fast
 * View page, already at its function-length budget, gains one element instead
 * of a hook call, its options and an element.
 */
export function AudioLibrarySection({
  songId,
  actions,
  onPersonalEntryCreated,
  notify,
  offline,
  readOnly,
}: AudioLibrarySectionProps) {
  const library = useAudioLibrary({ songId, actions, onPersonalEntryCreated, notify })
  return <AudioSection library={library} offline={offline} readOnly={readOnly} />
}

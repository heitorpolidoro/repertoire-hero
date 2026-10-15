import { useState } from 'react'
import { logger } from '@/lib/logger'
import { orderForPractice, type PracticeCandidate } from '@/lib/practiceOrder'
import { buildPracticeSession, type PracticeSource } from '@/lib/practiceSession'
import { writeSongQueue } from '@/lib/songQueue'

/** A playlist offered as a source. */
export interface PracticePlaylistChoice {
  id: string
  name: string
}

/**
 * The two reads a start makes, injected by the page (F21). There is no write
 * here on purpose: starting a session never touches `last_practiced` or a status.
 */
export interface PracticeActions {
  getCandidates: (source: PracticeSource, bandId: string | null) => Promise<PracticeCandidate[]>
  getPlaylists: (bandId: string | null) => Promise<PracticePlaylistChoice[]>
}

export interface UsePracticeStartOptions {
  /** The band whose repertoire is practised; `null` is the personal one. */
  bandId: string | null
  actions: PracticeActions
  /** The router's `push`. */
  push: (href: string) => void
  /** Injectable for tests; defaults to `Math.random`. */
  random?: () => number
  /** RH-172: when set, the button starts this source at once, with no menu. */
  fixedChoice?: PracticeChoice
  /** RH-172: overrides where Back from Fast View returns. */
  originHref?: string
}

export type PracticeChoice = { kind: 'repertoire' } | { kind: 'playlist'; id: string; name: string }

export interface PracticeStartController {
  open: boolean
  playlists: PracticePlaylistChoice[]
  pending: boolean
  /** The inline message under the button, or `null`. */
  message: string | null
  /** True when a fixed choice replaces the source menu. */
  fixed: boolean
  toggle: () => void
  start: (choice: PracticeChoice) => Promise<void>
}

export const EMPTY_SOURCE_MESSAGE = 'Nothing to practise here'

/**
 * RH-168 - the "Start practice" controller: the source menu, the one read, the
 * queue write and the jump into Fast View on the first song. An empty source
 * stores nothing, does not navigate and sets {@link EMPTY_SOURCE_MESSAGE}.
 */
export function usePracticeStart({
  bandId,
  actions,
  push,
  random,
  fixedChoice,
  originHref,
}: UsePracticeStartOptions): PracticeStartController {
  const [open, setOpen] = useState(false)
  const [playlists, setPlaylists] = useState<PracticePlaylistChoice[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const toggle = () => {
    if (fixedChoice) {
      void start(fixedChoice)
      return
    }
    const opening = !open
    setOpen(opening)
    if (!opening) return
    setMessage(null)
    actions
      .getPlaylists(bandId)
      .then(setPlaylists)
      // The menu still offers the whole repertoire when the playlists do not load.
      .catch(() => setPlaylists([]))
  }

  const start = async (choice: PracticeChoice) => {
    setOpen(false)
    setMessage(null)
    setPending(true)
    try {
      const source: PracticeSource =
        choice.kind === 'playlist' ? { kind: 'playlist', playlistId: choice.id } : { kind: 'repertoire' }
      const candidates = await actions.getCandidates(source, bandId)
      const session = buildPracticeSession({
        ordered: orderForPractice(candidates, { random }),
        owner: bandId ? { type: 'band', bandId } : { type: 'personal' },
        originHref,
        source: choice.kind === 'playlist' ? { kind: 'playlist', name: choice.name } : { kind: 'repertoire' },
      })
      if (!session) {
        setMessage(EMPTY_SOURCE_MESSAGE)
        return
      }
      writeSongQueue(session.queue)
      push(session.href)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to start practice', err)
      setMessage(err.message || 'Failed to start practice')
    } finally {
      setPending(false)
    }
  }

  return { open, playlists, pending, message, fixed: fixedChoice !== undefined, toggle, start }
}

import { create } from 'zustand'
import type { SourceKind } from '@/lib/setlistPlayer'
import type { SongQueueEntry } from '@/lib/songQueue'

export type PlayerStatus = 'idle' | 'playing' | 'paused' | 'stopped'

/** The tap that asks the player to start: the queue and the song on screen. */
export interface StartRequest {
  entries: SongQueueEntry[]
  versionId: string
  /** Where the queue was built (a band id or null), so the title links to the right Fast View. */
  bandId: string | null
}

interface SetlistPlayerState {
  /** Snapshot taken at start; the route and `clearSongQueue()` never touch it. */
  entries: SongQueueEntry[]
  index: number
  status: PlayerStatus
  kind: SourceKind | null
  /** The engine refused to start the current entry: shown as "Tap to play <title>". */
  refused: boolean
  /** Title of the last entry passed over for lack of a source. */
  skipped: string | null
  bandId: string | null
  /** Set by the "Play setlist" tap, consumed by the controller. */
  request: StartRequest | null
  requestStart: (request: StartRequest) => void
  consumeRequest: () => StartRequest | null
  begin: (entries: SongQueueEntry[], index: number, bandId: string | null) => void
  patch: (
    next: Partial<Pick<SetlistPlayerState, 'index' | 'status' | 'kind' | 'refused' | 'skipped'>>,
  ) => void
  reset: () => void
}

const INITIAL = {
  entries: [] as SongQueueEntry[],
  index: 0,
  status: 'idle' as PlayerStatus,
  kind: null as SourceKind | null,
  refused: false,
  skipped: null as string | null,
  bandId: null as string | null,
  request: null as StartRequest | null,
}

/** Not persisted: a reload starts with no player (nothing resumes by itself). */
export const useSetlistPlayerStore = create<SetlistPlayerState>()((set, get) => ({
  ...INITIAL,
  requestStart: (request) => set({ request }),
  consumeRequest: () => {
    const { request } = get()
    if (request) set({ request: null })
    return request
  },
  begin: (entries, index, bandId) =>
    set({ entries, index, bandId, status: 'paused', kind: null, refused: false, skipped: null }),
  patch: (next) => set(next),
  reset: () => set({ ...INITIAL }),
}))

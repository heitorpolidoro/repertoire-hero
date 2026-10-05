import { create } from 'zustand'
import {
  getRepertoireAction as getRepertoire,
  removeSongAction as removeSongFromRepertoire,
  updateSongStatusAction as updateSongStatus,
} from '@/app/actions/repertoire'
import { useBandContextStore } from '@/store/bandContextStore'
import type { Repertoire, SongStatus } from '@/types/database'

interface RepertoireState {
  songs: Repertoire[]
  isLoading: boolean
  searchQuery: string
  selectedStatus: SongStatus | null
  selectedTags: string[]

  // Actions
  loadSongs: () => Promise<void>
  updateStatus: (id: string, status: SongStatus) => Promise<void>
  removeSong: (id: string) => Promise<void>
  setSearchQuery: (q: string) => void
  setSelectedStatus: (s: SongStatus | null) => void
  toggleTag: (tag: string) => void

  // Derived
  filteredSongs: () => Repertoire[]
}

type SetState = (partial: Partial<RepertoireState>) => void

interface InFlightRead {
  bandId: string | null
  requestId: number
  promise: Promise<void>
}

// Request-ordering bookkeeping. It lives at module scope rather than in
// `RepertoireState` because nothing renders it: it is how the store decides
// which response is still relevant, not UI state.
//
// `currentRequestId` is the token of the only read allowed to write `songs`.
// Every `loadSongs` takes the next value; a mutation bumps it too, which
// invalidates every read in flight at that moment (the racing read is the
// *newest* read in the delete scenario, so a sequence number alone would not
// discard it).
let currentRequestId = 0
// "Is any read in flight", independent of which one wins — `isLoading` is
// cleared by the last request to settle, winner or not.
let inFlightCount = 0
// The read a duplicate `loadSongs()` for the same band context adopts instead
// of issuing a second `getRepertoireAction` call.
let inFlightRead: InFlightRead | null = null

function invalidateReads(): void {
  currentRequestId += 1
  // A `loadSongs()` issued after a mutation must start a fresh request rather
  // than adopt the one the bump just invalidated.
  inFlightRead = null
}

async function runLoad(requestId: number, bandId: string | null, set: SetState): Promise<void> {
  inFlightCount += 1
  set({ isLoading: true })
  try {
    const songs = await getRepertoire(bandId)
    const contextUnchanged = useBandContextStore.getState().bandId() === bandId
    if (requestId === currentRequestId && contextUnchanged) set({ songs })
  } finally {
    inFlightCount -= 1
    if (inFlightCount === 0) set({ isLoading: false })
  }
}

export const useRepertoireStore = create<RepertoireState>((set, get) => ({
  songs: [],
  isLoading: false,
  searchQuery: '',
  selectedStatus: null,
  selectedTags: [],

  loadSongs: async () => {
    const bandId = useBandContextStore.getState().bandId()
    if (inFlightRead && inFlightRead.bandId === bandId) return inFlightRead.promise

    const requestId = (currentRequestId += 1)
    const promise = runLoad(requestId, bandId, set)
    inFlightRead = { bandId, requestId, promise }
    const clear = (): void => {
      if (inFlightRead?.requestId === requestId) inFlightRead = null
    }
    // Both paths clear the dedupe slot; the derived promise absorbs the
    // rejection so this bookkeeping never reports an unhandled one. The
    // rejection itself still reaches the caller through `promise`.
    void promise.then(clear, clear)
    return promise
  },

  updateStatus: async (id: string, status: SongStatus) => {
    // RH-96: a band's status is its own row's, authored by a band admin — not
    // recomputed from the members — so the band branch writes like the personal
    // one. The server refuses a caller who is not an admin of that band.
    const bandId = useBandContextStore.getState().bandId()
    // Invalidate reads already in flight before the optimistic write, so none
    // of them can land afterwards and restore the old status.
    invalidateReads()
    set((state) => ({
      songs: state.songs.map((s) => (s.id === id ? { ...s, status } : s)),
    }))
    try {
      await updateSongStatus(id, status, bandId)
    } catch (error) {
      await get().loadSongs()
      throw error
    }
  },

  removeSong: async (id: string) => {
    const bandId = useBandContextStore.getState().bandId()
    const previous = get().songs
    // Same invalidation as `updateStatus`: a read that started before the
    // delete must not resurrect the removed row.
    invalidateReads()
    set((state) => ({
      songs: state.songs.filter((s) => s.id !== id),
    }))
    try {
      await removeSongFromRepertoire(id, bandId)
    } catch (error) {
      set({ songs: previous })
      throw error
    }
  },

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  setSelectedStatus: (s: SongStatus | null) => set({ selectedStatus: s }),

  toggleTag: (tag: string) =>
    set((state) => ({
      selectedTags: state.selectedTags.includes(tag)
        ? state.selectedTags.filter((t) => t !== tag)
        : [...state.selectedTags, tag],
    })),

  filteredSongs: () => {
    const { songs, searchQuery, selectedStatus, selectedTags } = get()
    return songs.filter((entry) => {
      const song = entry.song
      const matchesSearch = !searchQuery.trim() || (() => {
        const lower = searchQuery.toLowerCase()
        return (song?.title.toLowerCase().includes(lower) || song?.artist.toLowerCase().includes(lower)) ?? false
      })()
      const matchesStatus = selectedStatus === null || entry.status === selectedStatus
      const matchesTags = selectedTags.length === 0 || selectedTags.every((tag) => entry.tags.includes(tag))
      return matchesSearch && matchesStatus && matchesTags
    })
  },
}))

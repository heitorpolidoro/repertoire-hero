import { create } from 'zustand'
import {
  getRepertoire,
  removeSongFromRepertoire,
  updateSongStatus,
} from '@/lib/songs'
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

export const useRepertoireStore = create<RepertoireState>((set, get) => ({
  songs: [],
  isLoading: false,
  searchQuery: '',
  selectedStatus: null,
  selectedTags: [],

  loadSongs: async () => {
    set({ isLoading: true })
    try {
      const songs = await getRepertoire()
      set({ songs })
    } finally {
      set({ isLoading: false })
    }
  },

  updateStatus: async (id: string, status: SongStatus) => {
    // Optimistic update
    set((state) => ({
      songs: state.songs.map((s) => (s.id === id ? { ...s, status } : s)),
    }))

    try {
      await updateSongStatus(id, status)
    } catch (error) {
      // Roll back optimistic update on failure by reloading from server
      await get().loadSongs()
      throw error
    }
  },

  removeSong: async (id: string) => {
    // Optimistic update
    const previous = get().songs
    set((state) => ({
      songs: state.songs.filter((s) => s.id !== id),
    }))

    try {
      await removeSongFromRepertoire(id)
    } catch (error) {
      // Roll back optimistic update on failure
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

      // Filter by search query against title and artist
      const matchesSearch = !searchQuery.trim() || (() => {
        const lower = searchQuery.toLowerCase()
        return (song?.title.toLowerCase().includes(lower) || song?.artist.toLowerCase().includes(lower)) ?? false
      })()

      // Filter by selected status
      const matchesStatus = selectedStatus === null || entry.status === selectedStatus

      // Filter by selected tags — entry must include ALL selected tags
      const matchesTags = selectedTags.length === 0 || selectedTags.every((tag) => entry.tags.includes(tag))

      return matchesSearch && matchesStatus && matchesTags
    })
  },
}))

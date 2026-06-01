'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Image from 'next/image'
import type { SongStatus, Repertoire } from '@/types/database'
import { useRepertoireStore } from '@/store/repertoireStore'
import { STATUS_CONFIG, STATUS_ORDER, nextStatus } from '@/lib/statusConfig'
import { createAndAddSong, addSongToRepertoire, searchGlobalSongs } from '@/lib/songs'
import { searchSpotify, type SpotifyTrack } from '@/lib/spotify'
import type { GlobalSong } from '@/types/database'
import SongForm from '@/components/songs/SongForm'

// ---------------------------------------------------------------------------
// SongResultItem — shared row for catalog and Spotify search results
// ---------------------------------------------------------------------------
interface SongResultItemProps {
  coverUrl: string | null | undefined
  title: string
  artist: string
  album?: string | null
  adding: boolean
  error?: string
  onAdd: () => void
}

function SongResultItem({ coverUrl, title, artist, album, adding, error, onAdd }: SongResultItemProps) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm">
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt={`${title} cover`}
          width={40}
          height={40}
          className="h-10 w-10 rounded object-cover shrink-0"
          unoptimized
        />
      ) : (
        <div className="h-10 w-10 rounded bg-gray-100 shrink-0" aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
        <p className="text-xs text-gray-500 truncate">{artist}</p>
        {album && <p className="text-xs text-gray-400 italic truncate">{album}</p>}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          aria-label={`Add ${title} by ${artist} to repertoire`}
          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? 'Adding...' : 'Add'}
        </button>
        {error && <p className="text-xs text-red-500 text-right max-w-[120px]">{error}</p>}
      </div>
    </li>
  )
}

type ModalState =
  | { open: false }
  | { open: true; song?: Repertoire }

const ALL_STATUS_FILTERS: Array<{ value: SongStatus | null; label: string }> = [
  { value: null, label: 'All' },
  ...STATUS_ORDER.map((s) => ({ value: s as SongStatus, label: STATUS_CONFIG[s].label })),
]

const SPOTIFY_DEBOUNCE_MS = 500

export default function HomePage() {
  const {
    isLoading,
    searchQuery,
    selectedStatus,
    filteredSongs,
    songs: allSongs,
    loadSongs,
    setSearchQuery,
    setSelectedStatus,
    updateStatus,
    removeSong,
  } = useRepertoireStore()

  const [modal, setModal] = useState<ModalState>({ open: false })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [spotifyRowErrors, setSpotifyRowErrors] = useState<Record<string, string>>({})

  // Catalog search state
  const [catalogResults, setCatalogResults] = useState<GlobalSong[]>([])
  const [addingCatalogId, setAddingCatalogId] = useState<string | null>(null)
  const [catalogRowErrors, setCatalogRowErrors] = useState<Record<string, string>>({})

  // Spotify state
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrack[]>([])
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the most-recently-fired query so stale responses are discarded
  const latestQuery = useRef('')

  useEffect(() => {
    loadSongs()
  }, [loadSongs])

  // Debounced search — catalog + Spotify in parallel
  const runSearch = useCallback(async (query: string) => {
    latestQuery.current = query

    if (query.trim().length < 2) {
      setCatalogResults([])
      setSpotifyResults([])
      setSpotifyLoading(false)
      return
    }

    // Clear stale row-level errors from previous searches
    setCatalogRowErrors({})
    setSpotifyRowErrors({})
    setSpotifyLoading(true)

    try {
      const [catalog, spotify] = await Promise.all([
        searchGlobalSongs(query).catch(() => [] as GlobalSong[]),
        searchSpotify(query).catch(() => [] as SpotifyTrack[]),
      ])
      // Discard if a newer query already fired
      if (latestQuery.current !== query) return
      setCatalogResults(catalog)
      setSpotifyResults(spotify)
    } finally {
      if (latestQuery.current === query) setSpotifyLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    debounceTimer.current = setTimeout(() => {
      runSearch(searchQuery)
    }, SPOTIFY_DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [searchQuery, runSearch])

  const songs = filteredSongs()

  // Build a Set of "title|artist" keys for the user's repertoire — O(n) once per render
  const repertoireKeys = useMemo(
    () =>
      new Set(
        allSongs
          .filter((e) => e.song)
          .map((e) => `${e.song!.title.toLowerCase()}|${e.song!.artist.toLowerCase()}`)
      ),
    [allSongs]
  )

  // Catalog results: not already in user's repertoire — O(m) lookups
  const visibleCatalogResults = useMemo(
    () =>
      catalogResults.filter(
        (s) => !repertoireKeys.has(`${s.title.toLowerCase()}|${s.artist.toLowerCase()}`)
      ),
    [catalogResults, repertoireKeys]
  )

  // Spotify results: not in repertoire AND not already shown from catalog — O(m+k) lookups
  const catalogKeys = useMemo(
    () => new Set(visibleCatalogResults.map((s) => `${s.title.toLowerCase()}|${s.artist.toLowerCase()}`)),
    [visibleCatalogResults]
  )

  const visibleSpotifyResults = useMemo(
    () =>
      spotifyResults.filter((t) => {
        const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
        return !repertoireKeys.has(key) && !catalogKeys.has(key)
      }),
    [spotifyResults, repertoireKeys, catalogKeys]
  )

  const openAdd = () => setModal({ open: true })
  const openEdit = (song: Repertoire) => setModal({ open: true, song })
  const closeModal = () => setModal({ open: false })
  const handleSuccess = () => setModal({ open: false })

  const handleAddFromCatalog = async (song: GlobalSong) => {
    setAddingCatalogId(song.id)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setCatalogRowErrors(({ [song.id]: _, ...rest }) => rest)
    try {
      await addSongToRepertoire(song.id)
      await loadSongs()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
      setCatalogRowErrors((prev) => ({ ...prev, [song.id]: message }))
    } finally {
      setAddingCatalogId(null)
    }
  }

  const handleAddFromSpotify = async (track: SpotifyTrack) => {
    setAddingId(track.id)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setSpotifyRowErrors(({ [track.id]: _, ...rest }) => rest)
    try {
      await createAndAddSong({
        title: track.title,
        artist: track.artist,
        album: track.album ?? undefined,
        cover_url: track.albumArt ?? undefined,
        links: [{ label: 'Spotify', url: track.spotifyUrl }],
      })
      await loadSongs()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
      if (message.includes('already in your repertoire')) {
        setSpotifyRowErrors((prev) => ({ ...prev, [track.id]: 'Already in your repertoire.' }))
      } else {
        setSpotifyRowErrors((prev) => ({ ...prev, [track.id]: message }))
      }
    } finally {
      setAddingId(null)
    }
  }

  const showSearchResults =
    searchQuery.trim().length >= 2 &&
    (spotifyLoading || visibleCatalogResults.length > 0 || visibleSpotifyResults.length > 0)

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 md:px-6">
        <h1 className="text-xl font-bold text-gray-900 mb-3">My Repertoire</h1>

        {/* Search */}
        <div>
          <label
            htmlFor="search-input"
            className="text-sm font-medium text-gray-700 mb-1 block"
          >
            Search
          </label>
          <input
            id="search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Title or artist..."
            className="w-full rounded-lg border border-gray-200 pl-3 pr-4 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Status filter pills */}
        <div
          role="group"
          aria-label="Filter by status"
          className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none"
        >
          {ALL_STATUS_FILTERS.map(({ value, label }) => {
            const isActive = selectedStatus === value
            const cfg = value ? STATUS_CONFIG[value] : null
            return (
              <button
                key={value ?? 'all'}
                type="button"
                onClick={() => setSelectedStatus(value)}
                aria-pressed={isActive}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isActive
                    ? cfg
                      ? `${cfg.bgColor} ${cfg.textColor} border-current`
                      : 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </header>

      {/* Song list */}
      <section className="flex-1 overflow-y-auto px-4 py-4 md:px-6" aria-label="Song list">
        {isLoading ? (
          <div className="flex items-center justify-center h-40" aria-live="polite" aria-busy="true">
            <p className="text-sm text-gray-400">Loading...</p>
          </div>
        ) : songs.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-40 text-center gap-2"
            aria-live="polite"
          >
            <p className="text-gray-500 font-medium">No songs found</p>
            <p className="text-sm text-gray-400">
              {searchQuery || selectedStatus
                ? 'Try adjusting the filters.'
                : 'Add your first song with the + button'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {songs.map((song) => {
              const cfg = STATUS_CONFIG[song.status]
              return (
                <li
                  key={song.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm"
                >
                  {/* Cover image or status color square */}
                  {song.song?.cover_url ? (
                    <Image
                      src={song.song.cover_url}
                      alt={`${song.song.title} cover`}
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded object-cover shrink-0"
                      unoptimized
                    />
                  ) : (
                    <div
                      className={`w-10 h-10 rounded shrink-0 ${cfg.bgColor}`}
                      aria-hidden="true"
                    />
                  )}

                  {/* Title + artist + album */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {song.song?.title ?? '—'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {song.song?.artist ?? '—'}
                    </p>
                    {song.song?.album && (
                      <p className="text-xs text-gray-400 italic truncate">
                        {song.song.album}
                      </p>
                    )}
                  </div>

                  {/* Status badge — cycles to next status on click */}
                  <button
                    type="button"
                    onClick={() => { updateStatus(song.id, nextStatus(song.status)); }}
                    aria-label={`Status: ${cfg.label}. Click to advance.`}
                    className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-current ${cfg.bgColor} ${cfg.textColor}`}
                  >
                    {cfg.label}
                  </button>

                  {/* Edit button */}
                  <button
                    type="button"
                    onClick={() => openEdit(song)}
                    aria-label={`Edit ${song.song?.title ?? 'song'}`}
                    className="shrink-0 text-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>

                  {/* Delete button with inline confirm */}
                  {confirmDeleteId === song.id ? (
                    <span className="shrink-0 flex items-center gap-1">
                      <span className="text-xs text-gray-600">Sure?</span>
                      <button
                        type="button"
                        onClick={() => {
                          removeSong(song.id)
                          setConfirmDeleteId(null)
                        }}
                        aria-label={`Confirm delete ${song.song?.title ?? 'song'}`}
                        className="text-xs text-red-500 hover:text-red-700 focus:outline-none focus:underline"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        aria-label="Cancel delete"
                        className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(song.id)}
                      aria-label={`Delete ${song.song?.title ?? 'song'}`}
                      className="shrink-0 text-red-500 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* Separator + addable results */}
        {showSearchResults && (
          <section aria-label="Add to your repertoire" className="mt-4">

            {/* Divider */}
            <div className="flex items-center gap-3 mb-3">
              <hr className="flex-1 border-gray-200" />
              <span className="text-xs font-medium text-gray-400">Add to your repertoire</span>
              <hr className="flex-1 border-gray-200" />
            </div>

            {/* Flat list: catalog first, then Spotify */}
            <ul className="flex flex-col gap-2" aria-live="polite">

              {visibleCatalogResults.map((song) => (
                <SongResultItem
                  key={song.id}
                  coverUrl={song.cover_url}
                  title={song.title}
                  artist={song.artist}
                  album={song.album}
                  adding={addingCatalogId === song.id}
                  error={catalogRowErrors[song.id]}
                  onAdd={() => { handleAddFromCatalog(song); }}
                />
              ))}

              {spotifyLoading ? (
                <li className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400" aria-busy="true">
                  <svg className="animate-spin h-4 w-4 text-emerald-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Searching Spotify...
                </li>
              ) : (
                visibleSpotifyResults.map((track) => (
                  <SongResultItem
                    key={track.id}
                    coverUrl={track.albumArt}
                    title={track.title}
                    artist={track.artist}
                    album={track.album}
                    adding={addingId === track.id}
                    error={spotifyRowErrors[track.id]}
                    onAdd={() => { handleAddFromSpotify(track); }}
                  />
                ))
              )}

            </ul>
          </section>
        )}
      </section>

      {/* FAB — Add song */}
      <button
        type="button"
        onClick={openAdd}
        aria-label="Add song"
        className="fixed bottom-20 right-5 md:bottom-6 md:right-6 z-20 w-14 h-14 rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-300 transition-colors flex items-center justify-center text-2xl leading-none"
      >
        +
      </button>

      {/* Modal */}
      {modal.open && (
        <SongForm
          song={modal.song}
          onClose={closeModal}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getPlaylistWithSongs,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
} from '@/lib/playlists'
import { getUserRepertoire, updateSongStatus, updateSongTags } from '@/lib/songs'
import { STATUS_CONFIG, STATUS_ORDER, nextStatus } from '@/lib/statusConfig'
import { createClient } from '@/lib/supabase/client'
import type { Playlist, PlaylistSong, SongStatus, UserRepertoire } from '@/types/database'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return `${Math.floor(diffHrs / 24)}d ago`
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-indigo-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Tag editor
// ---------------------------------------------------------------------------

interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

function TagEditor({ tags, onChange }: TagEditorProps) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/,+$/, '').trim()
    if (!tag || tags.includes(tag)) {
      setInputValue('')
      return
    }
    onChange([...tags, tag])
    setInputValue('')
  }

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputValue)
    } else if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white cursor-text min-h-[2.5rem]"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeTag(tag) }}
            aria-label={`Remove tag ${tag}`}
            className="text-indigo-400 hover:text-indigo-700 focus:outline-none leading-none"
          >
            &times;
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (inputValue.trim()) addTag(inputValue) }}
        placeholder={tags.length === 0 ? 'Add tags…' : ''}
        className="flex-1 min-w-[8rem] text-xs text-gray-700 placeholder-gray-400 focus:outline-none bg-transparent"
        aria-label="Add a tag"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Playlist mastery summary
// ---------------------------------------------------------------------------

const STATUS_SCORES: Record<SongStatus, number> = {
  unknown: 0,
  learning: 1,
  practicing: 2,
  polishing: 3,
  mastered: 4,
}

// Solid bar colors that match STATUS_CONFIG (Tailwind bg classes won't work inside
// inline-style width, so we use raw hex values for the stacked bar segments).
const STATUS_BAR_COLORS: Record<SongStatus, string> = {
  unknown:    '#d1d5db', // gray-300
  learning:   '#93c5fd', // blue-300
  practicing: '#fde047', // yellow-300
  polishing:  '#fdba74', // orange-300
  mastered:   '#86efac', // green-300
}

interface PlaylistSummaryProps {
  songs: PlaylistSong[]
  repertoireMap: Map<string, UserRepertoire>
}

function PlaylistSummary({ songs, repertoireMap }: PlaylistSummaryProps) {
  const { counts, totalSeconds } = useMemo(() => {
    const c: Record<SongStatus, number> = {
      unknown: 0, learning: 0, practicing: 0, polishing: 0, mastered: 0,
    }
    let secs = 0
    for (const ps of songs) {
      const s = repertoireMap.get(ps.song_id)?.status ?? 'unknown'
      c[s]++
      secs += ps.song?.duration_seconds ?? 0
    }
    return { counts: c, totalSeconds: secs }
  }, [songs, repertoireMap])

  const total = songs.length
  if (total === 0) return null

  const score = Math.round(
    (STATUS_ORDER.reduce((sum, s) => sum + STATUS_SCORES[s] * counts[s], 0) / (total * 4)) * 100
  )

  // Nearest status label for the score
  const scoreStatus = STATUS_ORDER[Math.min(
    Math.floor((score / 100) * (STATUS_ORDER.length - 1) + 0.5),
    STATUS_ORDER.length - 1
  )]
  const cfg = STATUS_CONFIG[scoreStatus]

  return (
    <div className="px-4 py-3 md:px-6 border-b border-gray-100 bg-gray-50">
      {/* Score + total duration */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">
          Playlist level
          {totalSeconds > 0 && (
            <span className="ml-2 text-gray-400 font-normal">{formatDuration(totalSeconds)}</span>
          )}
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border border-current ${cfg.bgColor} ${cfg.textColor}`}>
          {cfg.label} &middot; {score}%
        </span>
      </div>

      {/* Stacked distribution bar */}
      <div className="flex h-2 rounded-full overflow-hidden gap-px" aria-label="Status distribution">
        {STATUS_ORDER.map((s) => {
          const pct = (counts[s] / total) * 100
          if (pct === 0) return null
          return (
            <div
              key={s}
              style={{ width: `${pct}%`, backgroundColor: STATUS_BAR_COLORS[s] }}
              title={`${STATUS_CONFIG[s].label}: ${counts[s]}`}
            />
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className="flex items-center gap-1 text-xs text-gray-500">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: STATUS_BAR_COLORS[s] }}
              aria-hidden="true"
            />
            {STATUS_CONFIG[s].label} ({counts[s]})
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlaylistDetailPage() {
  const params = useParams()
  const router = useRouter()
  const playlistId = params.id as string

  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [songs, setSongs] = useState<PlaylistSong[]>([])
  const [repertoireMap, setRepertoireMap] = useState<Map<string, UserRepertoire>>(new Map())
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [repertoire, setRepertoire] = useState<UserRepertoire[]>([])
  const [pickerSearch, setPickerSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)
  const [addingTagForSong, setAddingTagForSong] = useState<string | null>(null)
  const [newTagInput, setNewTagInput] = useState('')

  const refreshPlaylist = async () => {
    const [data, rep, { data: { user } }] = await Promise.all([
      getPlaylistWithSongs(playlistId),
      getUserRepertoire(),
      createClient().auth.getUser(),
    ])
    if (!data) { router.replace('/playlists'); return }
    setPlaylist(data)
    setSongs(data.songs ?? [])
    setRepertoireMap(new Map(rep.map((r) => [r.song_id, r])))
    setRepertoire(rep)
    setCurrentUserId(user?.id ?? null)
  }

  useEffect(() => {
    setLoading(true)
    refreshPlaylist()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load playlist'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId])

  // Open picker — reload repertoire if not loaded yet
  useEffect(() => {
    if (!showPicker || repertoire.length > 0) return
    getUserRepertoire()
      .then((rep) => {
        setRepertoire(rep)
        setRepertoireMap(new Map(rep.map((r) => [r.song_id, r])))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load repertoire'))
  }, [showPicker, repertoire.length])

  const currentSongIds = new Set(songs.map((s) => s.song_id))

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const ps of songs) {
      for (const tag of (repertoireMap.get(ps.song_id)?.tags ?? [])) set.add(tag)
    }
    return [...set].sort()
  }, [songs, repertoireMap])

  const filteredSongs = useMemo(() =>
    activeTagFilter
      ? songs.filter((ps) => repertoireMap.get(ps.song_id)?.tags.includes(activeTagFilter))
      : songs,
    [songs, repertoireMap, activeTagFilter]
  )

  const pickerSongs = repertoire.filter((r) => {
    if (currentSongIds.has(r.song_id)) return false
    if (!pickerSearch.trim()) return true
    const q = pickerSearch.toLowerCase()
    return r.song?.title.toLowerCase().includes(q) || r.song?.artist.toLowerCase().includes(q)
  })

  const autoPushIfNeeded = async () => {
    if (!playlist?.sync_with_spotify || !playlist?.spotify_playlist_id) return
    const res = await fetch(`/api/spotify/playlists/${playlistId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'push' }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? 'Auto-sync to Spotify failed')
    }
  }

  const handleAddSong = async (songId: string) => {
    setError(null)
    try {
      await addSongToPlaylist(playlistId, songId)
      const updated = await getPlaylistWithSongs(playlistId)
      setSongs(updated?.songs ?? [])
      await autoPushIfNeeded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add song')
    }
  }

  const handleRemoveSong = async (songId: string) => {
    setError(null)
    try {
      await removeSongFromPlaylist(playlistId, songId)
      setSongs((prev) => prev.filter((s) => s.song_id !== songId))
      await autoPushIfNeeded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove song')
    }
  }

  const handleStatusCycle = async (songId: string) => {
    const entry = repertoireMap.get(songId)
    if (!entry) return
    const next = nextStatus(entry.status)
    // Optimistic update
    setRepertoireMap((prev) => {
      const next_map = new Map(prev)
      next_map.set(songId, { ...entry, status: next })
      return next_map
    })
    try {
      await updateSongStatus(entry.id, next)
    } catch (err) {
      // Revert on failure
      setRepertoireMap((prev) => {
        const reverted = new Map(prev)
        reverted.set(songId, entry)
        return reverted
      })
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch(`/api/spotify/playlists/${playlistId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'pull' }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Sync failed')
      }
      await refreshPlaylist()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const handleRename = async () => {
    const trimmed = editName.trim()
    if (!trimmed) { setEditing(false); return }
    setError(null)
    try {
      await updatePlaylist(playlistId, { name: trimmed })
      setPlaylist((prev) => prev ? { ...prev, name: trimmed } : prev)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename')
    }
  }

  const handleTagsChange = async (tags: string[]) => {
    setPlaylist((prev) => prev ? { ...prev, tags } : prev)
    try {
      await updatePlaylist(playlistId, { tags })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tags')
    }
  }

  const handleAddSongTag = async (songId: string, tag: string) => {
    const trimmed = tag.trim().toLowerCase()
    if (!trimmed) return
    const entry = repertoireMap.get(songId)
    if (!entry) return
    if (entry.tags.includes(trimmed)) { setAddingTagForSong(null); setNewTagInput(''); return }
    const newTags = [...entry.tags, trimmed]
    setRepertoireMap((prev) => {
      const next = new Map(prev)
      next.set(songId, { ...entry, tags: newTags })
      return next
    })
    setAddingTagForSong(null)
    setNewTagInput('')
    try {
      await updateSongTags(entry.id, newTags)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tag')
    }
  }

  const handleRemoveSongTag = async (songId: string, tag: string) => {
    const entry = repertoireMap.get(songId)
    if (!entry) return
    const newTags = entry.tags.filter((t) => t !== tag)
    setRepertoireMap((prev) => {
      const next = new Map(prev)
      next.set(songId, { ...entry, tags: newTags })
      return next
    })
    try {
      await updateSongTags(entry.id, newTags)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove tag')
    }
  }

  const handleDelete = async () => {
    setError(null)
    try {
      await deletePlaylist(playlistId)
      router.replace('/playlists')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-gray-400">
        <Spinner />
        Loading...
      </div>
    )
  }

  if (!playlist) return null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 md:px-6 shrink-0">
        <div className="flex items-center gap-3">
          {/* Back */}
          <Link
            href="/playlists"
            aria-label="Back to playlists"
            className="p-1.5 rounded text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          </Link>

          {/* Cover */}
          {playlist.cover_url && (
            <Image
              src={playlist.cover_url}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded object-cover shrink-0"
              unoptimized
            />
          )}

          {/* Name / edit input */}
          {editing ? (
            <div className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRename()
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                className="flex-1 rounded border border-indigo-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Playlist name"
              />
              <button type="button" onClick={() => void handleRename()} className="text-xs text-indigo-600 font-medium hover:text-indigo-800 focus:outline-none focus:underline">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline">Cancel</button>
            </div>
          ) : (
            <h1 className="flex-1 text-lg font-bold text-gray-900 truncate">{playlist.name}</h1>
          )}

          {/* Actions */}
          {!editing && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => { setEditName(playlist.name); setEditing(true) }}
                aria-label="Rename playlist"
                className="p-1.5 rounded text-gray-400 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>

              {confirmDelete ? (
                <span className="flex items-center gap-1 text-xs px-1">
                  <span className="text-gray-600">Sure?</span>
                  <button type="button" onClick={() => void handleDelete()} className="text-red-500 font-medium hover:text-red-700 focus:outline-none focus:underline">Yes</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:text-gray-700 focus:outline-none focus:underline">No</button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete playlist"
                  className="p-1.5 rounded text-gray-400 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Spotify strip */}
        {playlist.spotify_playlist_id && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
            <span className="text-xs text-green-700 flex items-center gap-1.5">
              <span aria-hidden="true">🔄</span>
              {playlist.sync_with_spotify ? 'Auto-sync on' : 'Synced with Spotify'}
              {playlist.last_synced_at && (
                <span className="text-green-600">&middot; {timeAgo(playlist.last_synced_at)}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              aria-label="Sync with Spotify"
              className="flex items-center gap-1.5 text-xs text-green-700 border border-green-300 rounded-md px-2.5 py-1 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? <Spinner /> : <span aria-hidden="true">🔄</span>}
              Sync
            </button>
          </div>
        )}
      </header>

      {/* Tag editor */}
      {playlist && (playlist.band_id !== null || playlist.user_id === currentUserId) && (
        <div className="px-4 py-2 md:px-6 border-b border-gray-100 bg-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Tags</p>
          <TagEditor
            tags={playlist.tags ?? []}
            onChange={(tags) => void handleTagsChange(tags)}
          />
        </div>
      )}

      {/* Playlist level summary */}
      <PlaylistSummary songs={songs} repertoireMap={repertoireMap} />

      {/* Error */}
      {error && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600">{error}</p>
          <button type="button" onClick={() => setError(null)} className="text-xs text-red-400 hover:text-red-600 ml-3 focus:outline-none">✕</button>
        </div>
      )}

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="px-4 md:px-6 pb-2 flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTagFilter(activeTagFilter === tag ? null : tag)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                activeTagFilter === tag
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-indigo-700 border-indigo-200 hover:border-indigo-400'
              }`}
            >
              {tag}
            </button>
          ))}
          {activeTagFilter && (
            <button
              type="button"
              onClick={() => setActiveTagFilter(null)}
              className="px-2 py-0.5 rounded-full text-xs text-gray-400 hover:text-gray-600 border border-gray-200"
            >
              × clear
            </button>
          )}
        </div>
      )}

      {/* Song list */}
      <section className="flex-1 overflow-y-auto px-4 py-3 md:px-6 min-h-0" aria-label="Songs in this playlist">
        {songs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            No songs yet. Add some from your repertoire below.
          </p>
        ) : filteredSongs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            No songs tagged <span className="font-medium">#{activeTagFilter}</span>.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...filteredSongs]
              .sort((a, b) => a.position - b.position)
              .map((ps) => {
                const entry = repertoireMap.get(ps.song_id)
                const status = entry?.status ?? 'unknown'
                const tags = entry?.tags ?? []
                const cfg = STATUS_CONFIG[status]
                const isAddingTag = addingTagForSong === ps.song_id
                return (
                  <li
                    key={ps.id}
                    className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      {ps.song?.cover_url ? (
                        <Image
                          src={ps.song.cover_url}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded object-cover shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-indigo-100 shrink-0" aria-hidden="true" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{ps.song?.title ?? '—'}</p>
                        <p className="text-xs text-gray-500 truncate">{ps.song?.artist ?? '—'}</p>
                        {ps.song?.album && (
                          <p className="text-xs text-gray-400 italic truncate">{ps.song.album}</p>
                        )}
                      </div>
                      {ps.song?.duration_seconds != null && (
                        <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                          {formatDuration(ps.song.duration_seconds)}
                        </span>
                      )}
                      {/* Status badge */}
                      <button
                        type="button"
                        onClick={() => void handleStatusCycle(ps.song_id)}
                        aria-label={`Status: ${cfg.label}. Click to advance.`}
                        className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-current ${cfg.bgColor} ${cfg.textColor}`}
                      >
                        {cfg.label}
                      </button>
                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => void handleRemoveSong(ps.song_id)}
                        aria-label={`Remove ${ps.song?.title ?? 'song'} from playlist`}
                        className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>

                    {/* Tags row */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-[52px]">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="group flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => void handleRemoveSongTag(ps.song_id, tag)}
                            aria-label={`Remove tag ${tag}`}
                            className="opacity-0 group-hover:opacity-100 text-indigo-400 hover:text-indigo-700 transition-opacity leading-none"
                          >×</button>
                        </span>
                      ))}
                      {isAddingTag ? (
                        <input
                          autoFocus
                          type="text"
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleAddSongTag(ps.song_id, newTagInput)
                            if (e.key === 'Escape') { setAddingTagForSong(null); setNewTagInput('') }
                          }}
                          onBlur={() => {
                            if (newTagInput.trim()) void handleAddSongTag(ps.song_id, newTagInput)
                            else { setAddingTagForSong(null); setNewTagInput('') }
                          }}
                          placeholder="new tag"
                          className="px-2 py-0.5 rounded-full text-xs border border-indigo-300 text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-24"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAddingTagForSong(ps.song_id); setNewTagInput('') }}
                          aria-label="Add tag"
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                        >
                          + tag
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
          </ul>
        )}
      </section>

      {/* Add songs */}
      <div className="border-t border-gray-100 px-4 py-3 md:px-6 shrink-0">
        {showPicker ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Add from repertoire</h2>
              <button
                type="button"
                onClick={() => { setShowPicker(false); setPickerSearch('') }}
                className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
              >
                Done
              </button>
            </div>
            <input
              type="search"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Search songs..."
              autoFocus
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <ul className="max-h-48 overflow-y-auto flex flex-col gap-1">
              {pickerSongs.length === 0 ? (
                <li className="text-xs text-gray-400 text-center py-3">
                  {pickerSearch ? 'No matches' : 'All your songs are already in this playlist'}
                </li>
              ) : (
                pickerSongs.map((r) => {
                  const status = repertoireMap.get(r.song_id)?.status ?? 'unknown'
                  const cfg = STATUS_CONFIG[status]
                  return (
                    <li key={r.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                      {r.song?.cover_url ? (
                        <Image
                          src={r.song.cover_url}
                          alt=""
                          width={32}
                          height={32}
                          className="h-8 w-8 rounded object-cover shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div className="h-8 w-8 rounded bg-indigo-100 shrink-0" aria-hidden="true" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">{r.song?.title ?? '—'}</p>
                        <p className="text-xs text-gray-500 truncate">{r.song?.artist ?? '—'}</p>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-current ${cfg.bgColor} ${cfg.textColor}`}>
                        {cfg.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleAddSong(r.song_id)}
                        className="shrink-0 text-xs text-indigo-600 font-medium hover:text-indigo-800 focus:outline-none focus:underline"
                      >
                        Add
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="w-full py-2.5 rounded-lg border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-indigo-300 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
          >
            + Add songs
          </button>
        )}
      </div>
    </div>
  )
}

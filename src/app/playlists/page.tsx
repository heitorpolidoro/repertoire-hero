'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getUserPlaylists,
  createPlaylist,
  deletePlaylist,
  updatePlaylist,
} from '@/lib/playlists'
import type { Playlist, SpotifyPlaylist } from '@/types/database'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Spinner = ({ label = 'Loading' }: { label?: string }) => {
  return (
    <svg
      className="animate-spin h-4 w-4 text-emerald-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      aria-label={label}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Import modal
// ---------------------------------------------------------------------------

interface ImportModalProps {
  spotifyPlaylists: SpotifyPlaylist[]
  onClose: () => void
  onImported: () => void
}

interface PendingImport {
  playlist: SpotifyPlaylist
  syncWithSpotify: boolean
}

const ImportModal = ({ spotifyPlaylists, onClose, onImported }: ImportModalProps) => {
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleConfirmImport = async () => {
    if (!pendingImport) return
    setImportingId(pendingImport.playlist.id)
    setError(null)
    try {
      const res = await fetch(`/api/spotify/playlists/${pendingImport.playlist.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_with_spotify: pendingImport.syncWithSpotify }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Import failed (${res.status})`)
      }
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
      setImportingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Import Spotify playlist"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Import a Spotify playlist</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2" role="list">
          {spotifyPlaylists.length === 0 && (
            <li className="text-sm text-gray-400 text-center py-6">No Spotify playlists found.</li>
          )}
          {spotifyPlaylists.map((sp) => (
            <li key={sp.id}>
              {pendingImport?.playlist.id === sp.id ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-col gap-3">
                  <p className="text-sm font-medium text-gray-800">Import &ldquo;{sp.name}&rdquo;?</p>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pendingImport.syncWithSpotify}
                      onChange={(ev) =>
                        setPendingImport((prev) =>
                          prev ? { ...prev, syncWithSpotify: ev.target.checked } : prev
                        )
                      }
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Keep synced with Spotify
                  </label>
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmImport().catch(console.error)}
                      disabled={importingId === sp.id}
                      className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {importingId === sp.id ? 'Importing...' : 'Import'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingImport(null)}
                      className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm">
                  {sp.cover_url ? (
                    <Image
                      src={sp.cover_url}
                      alt={`${sp.name} cover`}
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded object-cover shrink-0"
                      unoptimized
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-emerald-100 shrink-0 flex items-center justify-center text-lg" aria-hidden="true">
                      🎵
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{sp.name}</p>
                    <p className="text-xs text-gray-500">{sp.total_tracks} tracks</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingImport({ playlist: sp, syncWithSpotify: false })}
                    className="shrink-0 px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                  >
                    Import
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Playlist card
// ---------------------------------------------------------------------------

interface PlaylistCardProps {
  playlist: Playlist
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onClick: () => void
}

const PlaylistCard = ({ playlist, onDelete, onRename, onClick }: PlaylistCardProps) => {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(playlist.name)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) renameInputRef.current?.focus()
  }, [editing])

  const handleRenameSubmit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== playlist.name) onRename(playlist.id, trimmed)
    setEditing(false)
  }

  const songCount = Array.isArray(playlist.songs) ? playlist.songs.length : null
  const totalSeconds = Array.isArray(playlist.songs)
    ? playlist.songs.reduce((sum: number, ps: { song?: { duration_seconds?: number | null } }) => sum + (ps.song?.duration_seconds ?? 0), 0)
    : 0
  const totalDuration = totalSeconds > 0
    ? (() => {
        const hours = Math.floor(totalSeconds / 3600)
        const mins = Math.floor((totalSeconds % 3600) / 60)
        const secs = totalSeconds % 60
        return hours > 0
          ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
          : `${mins}:${String(secs).padStart(2, '0')}`
      })()
    : null

  return (
    <li
      className="rounded-lg border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-emerald-200 hover:shadow-md transition-all"
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('button, input')) return
        onClick()
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') onClick() }}
      aria-label={`Open ${playlist.name}`}
    >
      {/* Cover */}
      {playlist.cover_url ? (
        <Image
          src={playlist.cover_url}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 rounded object-cover shrink-0"
          unoptimized
        />
      ) : (
        <div className="h-12 w-12 rounded bg-emerald-100 shrink-0 flex items-center justify-center text-xl" aria-hidden="true">
          🎵
        </div>
      )}

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2" onClick={(ev) => ev.stopPropagation()}>
            <input
              ref={renameInputRef}
              type="text"
              value={editName}
              onChange={(ev) => setEditName(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') handleRenameSubmit()
                if (ev.key === 'Escape') setEditing(false)
              }}
              className="flex-1 rounded border border-emerald-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button type="button" onClick={handleRenameSubmit} className="text-xs text-emerald-600 font-medium hover:text-emerald-800">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold text-gray-900 truncate">{playlist.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {songCount !== null && (
                <span className="text-xs text-gray-400">{songCount} {songCount === 1 ? 'song' : 'songs'}</span>
              )}
              {totalDuration && (
                <span className="text-xs text-gray-400 tabular-nums">{totalDuration}</span>
              )}
              {playlist.spotify_playlist_id && (
                <span className="text-xs text-green-600 flex items-center gap-0.5">
                  <span aria-hidden="true">🔄</span>
                  {playlist.sync_with_spotify ? 'Auto-sync' : 'Synced'}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action icons */}
      {!editing && (
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); setEditName(playlist.name); setEditing(true) }}
            aria-label={`Rename ${playlist.name}`}
            className="p-1.5 rounded text-gray-400 hover:text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </button>

          {confirmDelete ? (
            <span className="flex items-center gap-1 text-xs px-1" onClick={(ev) => ev.stopPropagation()}>
              <span className="text-gray-600">Sure?</span>
              <button type="button" onClick={() => { onDelete(playlist.id); setConfirmDelete(false) }} className="text-red-500 font-medium hover:text-red-700 focus:outline-none focus:underline">Yes</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:text-gray-700 focus:outline-none focus:underline">No</button>
            </span>
          ) : (
            <button
              type="button"
              onClick={(ev) => { ev.stopPropagation(); setConfirmDelete(true) }}
              aria-label={`Delete ${playlist.name}`}
              className="p-1.5 rounded text-gray-400 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PlaylistsPage = () => {
  const router = useRouter()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null)
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showCreateForm) createInputRef.current?.focus()
  }, [showCreateForm])

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await getUserPlaylists()
      setPlaylists(data)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to load playlists')
    }
  }, [])

  const loadSpotifyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/playlists')
      const body = (await res.json()) as SpotifyPlaylist[] | { connected: false }
      if (!Array.isArray(body) && body.connected === false) {
        setSpotifyConnected(false)
      } else {
        setSpotifyConnected(true)
        setSpotifyPlaylists(body as SpotifyPlaylist[])
      }
    } catch {
      setSpotifyConnected(false)
    }
  }, [])

  useEffect(() => {
    loadPlaylists().catch(console.error)
    loadSpotifyStatus().catch(console.error)
  }, [loadPlaylists, loadSpotifyStatus])

  const handleDisconnectSpotify = async () => {
    try {
      await fetch('/api/auth/spotify/disconnect', { method: 'POST' })
      setSpotifyConnected(false)
      setSpotifyPlaylists([])
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to disconnect Spotify')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deletePlaylist(id)
      setPlaylists((prev) => prev.filter((pl) => pl.id !== id))
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to delete playlist')
    }
  }

  const handleRename = async (id: string, name: string) => {
    setPlaylists((prev) => prev.map((pl) => (pl.id === id ? { ...pl, name } : pl)))
    try {
      await updatePlaylist(id, { name })
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to rename playlist')
      await loadPlaylists()
    }
  }

  const handleCreatePlaylist = async () => {
    const name = newPlaylistName.trim()
    if (!name) return
    setIsCreating(true)
    try {
      await createPlaylist({ name })
      setNewPlaylistName('')
      setShowCreateForm(false)
      await loadPlaylists()
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to create playlist')
    } finally {
      setIsCreating(false)
    }
  }

  const handleImported = async () => {
    setShowImportModal(false)
    await loadPlaylists()
  }

  interface PlaylistGroup {
    type: 'personal' | 'band'
    bandId?: string
    bandName?: string
    playlists: Playlist[]
  }

  const groupedPlaylists = useMemo<PlaylistGroup[]>(() => {
    const personal = playlists.filter((pl) => pl.band_id === null)
    const bandMap = new Map<string, { name: string; playlists: Playlist[] }>()
    for (const pl of playlists) {
      if (pl.band_id === null) continue
      const existing = bandMap.get(pl.band_id)
      if (existing) {
        existing.playlists.push(pl)
      } else {
        bandMap.set(pl.band_id, {
          name: pl.band?.name ?? pl.band_id,
          playlists: [pl],
        })
      }
    }
    const bandGroups: PlaylistGroup[] = [...bandMap.entries()]
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([bandId, { name, playlists: bPlaylists }]) => ({
        type: 'band' as const,
        bandId,
        bandName: name,
        playlists: bPlaylists,
      }))
    const groups: PlaylistGroup[] = []
    if (personal.length > 0) {
      groups.push({ type: 'personal', playlists: personal })
    }
    groups.push(...bandGroups)
    return groups
  }, [playlists])

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 md:px-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Playlists</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-4 md:px-6 flex flex-col gap-4">
        {/* Error banner */}
        {pageError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-red-700">{pageError}</p>
            <button type="button" onClick={() => setPageError(null)} aria-label="Dismiss error" className="text-red-500 hover:text-red-700 text-xs shrink-0 focus:outline-none focus:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Create form */}
        {showCreateForm && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label htmlFor="new-playlist-name" className="sr-only">Playlist name</label>
            <input
              ref={createInputRef}
              id="new-playlist-name"
              type="text"
              value={newPlaylistName}
              onChange={(ev) => setNewPlaylistName(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') handleCreatePlaylist().catch(console.error)
                if (ev.key === 'Escape') setShowCreateForm(false)
              }}
              placeholder="Playlist name"
              className="flex-1 rounded-md border border-emerald-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleCreatePlaylist().catch(console.error)}
                disabled={isCreating || !newPlaylistName.trim()}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Spotify connection */}
        {spotifyConnected === null && (
          <div className="rounded-lg border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-2 text-sm text-gray-400" aria-live="polite" aria-busy="true">
            <Spinner />
            Checking Spotify connection...
          </div>
        )}

        {spotifyConnected === false && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" role="region" aria-label="Spotify connection">
            <div>
              <p className="text-sm font-semibold text-gray-800"><span aria-hidden="true">🎵</span> Connect your Spotify account</p>
              <p className="text-xs text-gray-500 mt-0.5">Import playlists and keep them in sync.</p>
            </div>
            <a
              href="/api/auth/spotify/authorize"
              className="shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors"
            >
              Connect Spotify
            </a>
          </div>
        )}

        {spotifyConnected === true && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" role="region" aria-label="Spotify connection">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium border border-green-200">
                <span aria-hidden="true">✓</span> Connected to Spotify
              </span>
              <button
                type="button"
                onClick={() => handleDisconnectSpotify().catch(console.error)}
                className="text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus:underline"
              >
                Disconnect
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="shrink-0 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-700 font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
            >
              Import a Spotify playlist
            </button>
          </div>
        )}

        {/* Playlist list grouped by band */}
        {playlists.length === 0 && spotifyConnected !== null ? (
          <div className="flex flex-col items-center justify-center h-40 text-center gap-2" aria-live="polite">
            <p className="text-gray-500 font-medium">No playlists yet</p>
            <p className="text-sm text-gray-400">
              Create your first playlist with the &ldquo;+ New Playlist&rdquo; button
              {spotifyConnected && ' or import one from Spotify'}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Personal section — always render "My playlists" header with New Playlist button */}
            <section aria-label="My playlists">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">My playlists</p>
                <button
                  type="button"
                  onClick={() => { setShowCreateForm(true); setNewPlaylistName('') }}
                  className="shrink-0 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                >
                  + New Playlist
                </button>
              </div>
              {groupedPlaylists.find((g) => g.type === 'personal') ? (
                <ul className="flex flex-col gap-3" role="list">
                  {(groupedPlaylists.find((g) => g.type === 'personal')?.playlists ?? []).map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onClick={() => router.push(`/playlists/${playlist.id}`)}
                      onDelete={(id) => void handleDelete(id)}
                      onRename={(id, name) => void handleRename(id, name)}
                    />
                  ))}
                </ul>
              ) : (
                playlists.length === 0 ? null : (
                  <p className="text-sm text-gray-400 text-center py-4">No personal playlists yet.</p>
                )
              )}
            </section>

            {/* Band sections */}
            {groupedPlaylists
              .filter((g) => g.type === 'band')
              .map((group) => (
                <section key={group.bandId} aria-label={`Band: ${group.bandName}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Link
                      href={`/bands/${group.bandId}`}
                      className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900 focus:outline-none focus:underline"
                    >
                      🎸 {group.bandName}
                    </Link>
                  </div>
                  <ul className="flex flex-col gap-3" role="list">
                    {group.playlists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        onClick={() => router.push(`/playlists/${playlist.id}`)}
                        onDelete={(id) => handleDelete(id).catch(console.error)}
                        onRename={(id, name) => handleRename(id, name).catch(console.error)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </section>

      {/* Import modal */}
      {showImportModal && (
        <ImportModal
          spotifyPlaylists={spotifyPlaylists}
          onClose={() => setShowImportModal(false)}
          onImported={() => handleImported().catch(console.error)}
        />
      )}
    </div>
  )
}

export default PlaylistsPage

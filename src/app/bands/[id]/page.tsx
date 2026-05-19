'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  getBandWithMembers,
  updateBand,
  deleteBand,
  leaveBand,
  removeBandMember,
  getBandPlaylists,
  createBandPlaylist,
} from '@/lib/bands'
import { createClient } from '@/lib/supabase/client'
import { INSTRUMENT_ICONS } from '@/components/profile/InstrumentPicker'
import type { Band, BandMember, Playlist } from '@/types/database'

export default function BandDetailPage() {
  const { id: bandId } = useParams<{ id: string }>()
  const router = useRouter()

  const [band, setBand] = useState<Band | null>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit band modal state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // New playlist state
  const [showNewPlaylist, setShowNewPlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)

  // Invite link copy state
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    setCurrentUserId(user?.id ?? null)

    const [bandData, playlistData] = await Promise.all([
      getBandWithMembers(bandId),
      getBandPlaylists(bandId),
    ])

    if (!bandData) {
      router.replace('/bands')
      return
    }

    setBand(bandData)
    setPlaylists(playlistData)
    setLoading(false)
  }, [bandId, router])

  useEffect(() => { load() }, [load])

  const currentMember = band?.members?.find((m) => m.user_id === currentUserId)
  const isAdmin = currentMember?.role === 'admin'
  const inviteUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/join/${band?.invite_code ?? ''}`
    : ''

  async function handleCopyInvite() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openEdit() {
    setEditName(band?.name ?? '')
    setEditDesc(band?.description ?? '')
    setEditing(true)
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editName.trim()) return
    setSaving(true)
    try {
      await updateBand(bandId, { name: editName.trim(), description: editDesc.trim() || null })
      setBand((prev) => prev ? { ...prev, name: editName.trim(), description: editDesc.trim() || null } : prev)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${band?.name}"? This cannot be undone.`)) return
    try {
      await deleteBand(bandId)
      router.replace('/bands')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete band')
    }
  }

  async function handleLeave() {
    if (!currentUserId) return
    if (!confirm('Leave this band?')) return
    try {
      await leaveBand(bandId, currentUserId)
      router.replace('/bands')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to leave band')
    }
  }

  async function handleRemoveMember(member: BandMember) {
    if (!confirm(`Remove ${member.profile?.full_name ?? 'this member'}?`)) return
    try {
      await removeBandMember(member.id)
      setBand((prev) =>
        prev ? { ...prev, members: prev.members?.filter((m) => m.id !== member.id) } : prev
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    }
  }

  async function handleCreatePlaylist(e: React.FormEvent) {
    e.preventDefault()
    if (!newPlaylistName.trim() || !currentUserId) return
    setCreatingPlaylist(true)
    try {
      const playlistId = await createBandPlaylist(bandId, newPlaylistName.trim(), currentUserId)
      router.push(`/playlists/${playlistId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create playlist')
      setCreatingPlaylist(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!band) return null

  const members = band.members ?? []

  return (
    <>
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
          >
            ← Back
          </button>

          <div className="flex items-start gap-4">
            {band.cover_url ? (
              <img
                src={band.cover_url}
                alt={band.name}
                className="w-16 h-16 rounded-2xl object-cover shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-3xl shrink-0">
                🎸
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">{band.name}</h1>
              {band.description && (
                <p className="text-sm text-gray-500 mt-0.5">{band.description}</p>
              )}
            </div>
            {isAdmin && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={openEdit}
                  title="Edit band"
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                >
                  ✏️
                </button>
                <button
                  onClick={handleDelete}
                  title="Delete band"
                  className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors"
                >
                  🗑️
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
        )}

        {/* Invite link */}
        <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900 mb-3">Invite link</h2>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 truncate"
            />
            <button
              onClick={handleCopyInvite}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Anyone with this link can join the band.
          </p>
        </section>

        {/* Members */}
        <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900 mb-3">
            Members <span className="text-gray-400 font-normal text-sm">({members.length})</span>
          </h2>
          <ul className="space-y-2">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-semibold text-emerald-700 shrink-0">
                  {(member.profile?.full_name ?? member.profile?.email ?? '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {member.profile?.full_name ?? member.profile?.email ?? 'Unknown'}
                    {member.user_id === currentUserId && (
                      <span className="ml-1 text-xs text-gray-400">(you)</span>
                    )}
                  </p>
                  {member.profile?.primary_instrument && (
                    <p className="text-xs text-gray-500 truncate">
                      <span aria-hidden="true">{INSTRUMENT_ICONS[member.profile.primary_instrument] ?? '🎵'}</span>
                      {' '}{member.profile.primary_instrument}
                    </p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  member.role === 'admin'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {member.role}
                </span>
                {isAdmin && member.user_id !== currentUserId && (
                  <button
                    onClick={() => handleRemoveMember(member)}
                    className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
                    title="Remove member"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!isAdmin && currentMember && (
            <button
              onClick={handleLeave}
              className="mt-4 text-sm text-red-600 hover:text-red-700 font-medium"
            >
              Leave band
            </button>
          )}
        </section>

        {/* Band playlists */}
        <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Playlists</h2>
            <button
              onClick={() => setShowNewPlaylist(!showNewPlaylist)}
              className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
            >
              + New playlist
            </button>
          </div>

          {showNewPlaylist && (
            <form onSubmit={handleCreatePlaylist} className="flex gap-2 mb-4">
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Playlist name"
                required
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={creatingPlaylist}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
              >
                {creatingPlaylist ? '...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowNewPlaylist(false)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </form>
          )}

          {playlists.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No playlists yet.</p>
          ) : (
            <ul className="space-y-2">
              {playlists.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    onClick={() => router.push(`/playlists/${playlist.id}`)}
                    className="w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-xl">🎶</span>
                    <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                      {playlist.name}
                    </span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {(() => {
                        const songs = (playlist as unknown as { songs?: Array<{ song?: { duration_seconds?: number | null } }> }).songs ?? []
                        const count = songs.length
                        const secs = songs.reduce((sum, ps) => sum + (ps.song?.duration_seconds ?? 0), 0)
                        const dur = secs > 0
                          ? ` · ${Math.floor(secs / 3600) > 0 ? `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}`
                          : ''
                        return `${count} ${count === 1 ? 'song' : 'songs'}${dur}`
                      })()}
                    </span>
                    <span className="text-gray-400">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Leave band (for non-admin members, shown at bottom too) */}
        {isAdmin && members.length > 1 && (
          <button
            onClick={handleLeave}
            className="text-sm text-red-600 hover:text-red-700 font-medium"
          >
            Leave band
          </button>
        )}
      </div>

      {/* Edit band modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md px-6 py-6 space-y-4"
          >
            <h2 className="text-lg font-semibold text-gray-900">Edit Band</h2>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <input
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

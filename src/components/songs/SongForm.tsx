'use client'

import { useEffect, useRef, useState } from 'react'
import type { SongLink, SongStatus, UserRepertoire } from '@/types/database'
import { STATUS_CONFIG, STATUS_ORDER } from '@/lib/statusConfig'
import {
  createAndAddSong,
  updateSong,
  updateSongStatus,
  updateSongTags,
} from '@/lib/songs'
import { useRepertoireStore } from '@/store/repertoireStore'

interface SongFormProps {
  song?: UserRepertoire
  onClose: () => void
  onSuccess: () => void
}

interface FormState {
  title: string
  artist: string
  album: string
  key: string
  cover_url: string
  youtube_url: string
  duration: string
  status: SongStatus
  tagsInput: string
  links: Array<SongLink & { id?: string }>
}

function buildInitialState(song?: UserRepertoire): FormState {
  const dur = song?.song?.duration_seconds
  const allLinks = song?.song?.links ? [...song.song.links] : []
  const youtubeLink = allLinks.find((l) => l.label.toLowerCase() === 'youtube')
  const otherLinks = allLinks.filter((l) => l.label.toLowerCase() !== 'youtube')

  return {
    title:     song?.song?.title ?? '',
    artist:    song?.song?.artist ?? '',
    album:     song?.song?.album ?? '',
    key:       song?.personal_key ?? song?.song?.standard_key ?? '',
    cover_url: song?.song?.cover_url ?? '',
    youtube_url: youtubeLink ? youtubeLink.url : '',
    duration:  dur != null ? String(dur) : '',
    status:    song?.status ?? 'unknown',
    tagsInput: song?.tags.join(', ') ?? '',
    links:     otherLinks.map((l) => ({ ...l, id: l.url || Math.random().toString(36).substring(2, 9) })),
  }
}

export default function SongForm({ song, onClose, onSuccess }: SongFormProps) {
  const isEditMode = Boolean(song)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { loadSongs } = useRepertoireStore()

  const [form, setForm] = useState<FormState>(() => buildInitialState(song))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Open dialog on mount, close on backdrop click
  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }

  // ---- field helpers ----

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const addLink = () => {
    setField('links', [...form.links, { label: '', url: '', id: Math.random().toString(36).substring(2, 9) }])
  }

  const updateLink = (index: number, field: keyof SongLink, value: string) => {
    const updated = form.links.map((link, i) =>
      i === index ? { ...link, [field]: value } : link,
    )
    setField('links', updated)
  }

  const removeLink = (index: number) => {
    setField('links', form.links.filter((_, i) => i !== index))
  }

  // ---- submit ----

  // Accepts "3:45" or "225" → seconds
  const parseDuration = (raw: string): number | null => {
    if (raw.includes(':')) {
      const [min, sec] = raw.split(':').map(Number)
      if (isNaN(min) || isNaN(sec)) return null
      return min * 60 + sec
    }
    const n = Number(raw)
    return isNaN(n) ? null : n
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }

    setSubmitting(true)

    try {
      const tags = parseTags(form.tagsInput)
      let links = form.links.map(({ label, url }) => ({ label, url })).filter((l) => l.url.trim())
      if (form.youtube_url.trim()) {
        links = [{ label: 'YouTube', url: form.youtube_url.trim() }, ...links]
      }

      const durSeconds = form.duration.trim() ? parseDuration(form.duration.trim()) : null

      if (isEditMode && song) {
        await updateSong(song, {
          title:            form.title.trim(),
          artist:           form.artist.trim(),
          album:            form.album.trim() || null,
          key:              form.key.trim() || null,
          cover_url:        form.cover_url.trim() || null,
          duration_seconds: durSeconds,
          status:           form.status,
          tags,
          links,
        })
      } else {
        const entry = await createAndAddSong({
          title:            form.title.trim(),
          artist:           form.artist.trim(),
          album:            form.album.trim() || undefined,
          standard_key:     form.key.trim() || undefined,
          cover_url:        form.cover_url.trim() || undefined,
          duration_seconds: durSeconds ?? undefined,
          links,
        })
        // Apply status and tags after creation
        await Promise.all([
          form.status !== 'unknown'
            ? updateSongStatus(entry.id, form.status)
            : Promise.resolve(),
          tags.length > 0
            ? updateSongTags(entry.id, tags)
            : Promise.resolve(),
        ])
      }

      await loadSongs()
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      aria-label={isEditMode ? 'Edit song' : 'Add song'}
      className="w-full max-w-lg rounded-2xl p-0 shadow-xl backdrop:bg-black/50 open:flex open:flex-col"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">
          {isEditMode ? 'Edit song' : 'Add song'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 flex flex-col gap-5 max-h-[80vh]">
        {/* Title */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-title" className="text-sm font-medium text-gray-700">
            Title <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            id="sf-title"
            type="text"
            required
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="Song name"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Artist */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-artist" className="text-sm font-medium text-gray-700">
            Artist
          </label>
          <input
            id="sf-artist"
            type="text"
            value={form.artist}
            onChange={(e) => setField('artist', e.target.value)}
            placeholder="Artist name"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Album */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-album" className="text-sm font-medium text-gray-700">
            Album
          </label>
          <input
            id="sf-album"
            type="text"
            value={form.album}
            onChange={(e) => setField('album', e.target.value)}
            placeholder="Album name"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Key */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-key" className="text-sm font-medium text-gray-700">
            Key
          </label>
          <input
            id="sf-key"
            type="text"
            value={form.key}
            onChange={(e) => setField('key', e.target.value)}
            placeholder="ex: Am, G, C#"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-32"
          />
        </div>

        {/* Duration */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-duration" className="text-sm font-medium text-gray-700">
            Duration
          </label>
          <input
            id="sf-duration"
            type="text"
            value={form.duration}
            onChange={(e) => setField('duration', e.target.value)}
            placeholder="ex: 3:45 ou 225"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-32"
          />
        </div>

        {/* YouTube Link */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-youtube" className="text-sm font-medium text-gray-700">
            YouTube Link
          </label>
          <input
            id="sf-youtube"
            type="url"
            value={form.youtube_url}
            onChange={(e) => setField('youtube_url', e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Cover Image URL */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-cover-url" className="text-sm font-medium text-gray-700">
            Cover Image URL
          </label>
          <input
            id="sf-cover-url"
            type="url"
            value={form.cover_url}
            onChange={(e) => setField('cover_url', e.target.value)}
            placeholder="https://..."
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {form.cover_url.trim() && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.cover_url.trim()}
              alt="Cover preview"
              className="mt-1 h-16 w-16 rounded object-cover"
            />
          )}
        </div>

        {/* Status */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-700">Status</legend>

          <div className="flex flex-wrap gap-2" role="radiogroup">
            {STATUS_ORDER.map((s) => {
              const cfg = STATUS_CONFIG[s]
              const checked = form.status === s
              return (
                <label key={s} className="cursor-pointer">
                  <input
                    type="radio"
                    name="sf-status"
                    value={s}
                    checked={checked}
                    onChange={() => setField('status', s)}
                    className="sr-only"
                  />
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-medium border-2 transition-colors ${cfg.bgColor} ${cfg.textColor} ${
                      checked ? 'border-current' : 'border-transparent'
                    }`}
                  >
                    {cfg.label}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {/* Tags */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-tags" className="text-sm font-medium text-gray-700">
            Tags
          </label>
          <input
            id="sf-tags"
            type="text"
            value={form.tagsInput}
            onChange={(e) => setField('tagsInput', e.target.value)}
            placeholder="bossa nova, 80s, samba (comma-separated)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {form.tagsInput && (
            <ul className="flex flex-wrap gap-1.5 mt-1" aria-label="Tag preview">
              {parseTags(form.tagsInput).map((tag) => (
                <li
                  key={tag}
                  className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Links */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-gray-700">Links</legend>
          {form.links.map((link, idx) => (
            <div key={link.id || idx} className="flex gap-2 items-start">
              <div className="flex flex-col gap-1 flex-1">
                <input
                  type="text"
                  value={link.label}
                  onChange={(e) => updateLink(idx, 'label', e.target.value)}
                  placeholder="Label (e.g. YouTube, Chords)"
                  aria-label={`Label for link ${idx + 1}`}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="url"
                  value={link.url}
                  onChange={(e) => updateLink(idx, 'url', e.target.value)}
                  placeholder="https://"
                  aria-label={`URL for link ${idx + 1}`}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => removeLink(idx)}
                aria-label={`Remove link ${idx + 1}`}
                className="mt-1 text-gray-400 hover:text-red-500 transition-colors text-lg leading-none shrink-0"
              >
                &times;
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addLink}
            className="self-start text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
          >
            + Add link
          </button>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Footer buttons */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Saving...' : isEditMode ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

// Helper re-exported so the dialog can call parseTags without duplication
export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

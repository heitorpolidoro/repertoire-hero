'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Repertoire } from '@/types/database'
import { STATUS_CONFIG, nextStatus } from '@/lib/statusConfig'
import { useRepertoireStore } from '@/store/repertoireStore'

interface SongCardProps {
  song: Repertoire
  onEdit: (song: Repertoire) => void
}

export default function SongCard({ song, onEdit }: SongCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { updateStatus, removeSong } = useRepertoireStore()

  const config = STATUS_CONFIG[song.status]
  const title = song.song?.title ?? '(untitled)'
  const artist = song.song?.artist ?? ''

  const handleCycleStatus = async () => {
    await updateStatus(song.id, nextStatus(song.status))
  }

  const handleDelete = async () => {
    await removeSong(song.id)
  }

  return (
    <article className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Link
            href={`/songs/${song.id}/fast-view`}
            className="block font-semibold text-gray-900 hover:text-emerald-600 transition-colors truncate"
          >
            {title}
          </Link>
          {artist && (
            <p className="text-sm text-gray-500 truncate">{artist}</p>
          )}
        </div>

        {/* Status cycling badge */}
        <button
          type="button"
          onClick={handleCycleStatus}
          title={`Current status: ${config.label}. Click to advance.`}
          aria-label={`Advance status of ${title}`}
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80 ${config.bgColor} ${config.textColor}`}
        >
          {config.label}
        </button>
      </div>

      {/* Tags */}
      {song.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {song.tags.map((tag) => (
            <li
              key={tag}
              className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      {/* Actions row */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-50">
        <button
          type="button"
          onClick={() => onEdit(song)}
          className="text-xs font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
        >
          Edit
        </button>

        {confirmDelete ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-600">Remove?</span>
            <button
              type="button"
              onClick={handleDelete}
              className="font-medium text-red-600 hover:text-red-800 transition-colors"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </article>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Repertoire } from '@/types/database'
import { STATUS_CONFIG } from '@/lib/statusConfig'
import { getSongEntryAction as getSongEntry } from '@/app/actions/repertoire'

export default function FastViewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [entry, setEntry] = useState<Repertoire | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await getSongEntry(id)
        if (!cancelled) {
          if (!data) {
            setNotFound(true)
          } else {
            setEntry(data)
          }
        }
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" aria-busy="true">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (notFound || !entry) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-gray-700">Song not found</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
        >
          &larr; Back
        </button>
      </div>
    )
  }

  const title = entry.song?.title ?? '(untitled)'
  const artist = entry.song?.artist ?? ''
  const key = entry.personal_key ?? entry.song?.standard_key
  const cfg = STATUS_CONFIG[entry.status]
  const links = entry.song?.links ?? []

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-8 flex flex-col gap-6 max-w-xl mx-auto">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.back()}
        className="self-start text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
        aria-label="Back"
      >
        &larr; Back
      </button>

      {/* Song identity */}
      <section aria-label="Song details" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 leading-tight">{title}</h1>
            {artist && (
              <p className="mt-1 text-lg text-gray-500">{artist}</p>
            )}
          </div>
          <span
            className={`shrink-0 mt-1 px-3 py-1 rounded-full text-sm font-medium ${cfg.bgColor} ${cfg.textColor}`}
          >
            {cfg.label}
          </span>
        </div>

        {key && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">Key:</span> {key}
          </p>
        )}
      </section>

      {/* Links */}
      {links.length > 0 && (
        <section aria-label="Links" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Links</h2>
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full px-5 py-4 rounded-xl bg-white border border-gray-200 shadow-sm text-emerald-600 font-medium hover:bg-emerald-50 hover:border-emerald-200 transition-colors"
                >
                  <span>{link.label || link.url}</span>
                  <span aria-hidden="true" className="text-lg">&#8599;</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <section aria-label="Tags">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Tags</h2>
          <ul className="flex flex-wrap gap-2">
            {entry.tags.map((tag) => (
              <li
                key={tag}
                className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm"
              >
                {tag}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

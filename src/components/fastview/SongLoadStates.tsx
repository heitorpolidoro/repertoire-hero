'use client'

export interface SongNotFoundProps {
  onBack: () => void
}

/** The whole-screen placeholder shown while the route's entry loads. */
export function SongLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center" aria-busy="true">
      <p className="text-gray-400 text-sm">Loading...</p>
    </div>
  )
}

/**
 * The whole-screen placeholder for an entry that does not exist, or that the
 * viewer may not read — the load failure lands here too.
 */
export function SongNotFound({ onBack }: SongNotFoundProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg font-semibold text-gray-700">Song not found</p>
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
      >
        &larr; Back
      </button>
    </div>
  )
}

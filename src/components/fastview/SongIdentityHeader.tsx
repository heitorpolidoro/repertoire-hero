'use client'

import type { SongIdentity } from '@/lib/songEntry'
import type { SongStatusController } from '@/lib/songStatus'
import { StatusDropdown } from './StatusDropdown'

export interface SongIdentityHeaderProps {
  identity: SongIdentity
  status: SongStatusController
}

/**
 * The "Song details" section: the title, the optional artist line, the optional
 * key line and the mastery-status dropdown.
 *
 * Presentational only — the three fields come from `songIdentity()` and the
 * status write belongs to `useSongStatus` (RH-52).
 */
export function SongIdentityHeader({ identity, status }: SongIdentityHeaderProps) {
  return (
    <section aria-label="Song details" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 leading-tight">{identity.title}</h1>
          {identity.artist && (
            <p className="mt-1 text-lg text-gray-500">{identity.artist}</p>
          )}
        </div>
        <StatusDropdown controller={status} />
      </div>

      {identity.key && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">Key:</span> {identity.key}
        </p>
      )}
    </section>
  )
}

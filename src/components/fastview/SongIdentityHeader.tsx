'use client'

import type { SongIdentity } from '@/lib/songEntry'
import { StatusNotes } from '@/components/ui/StatusNotes'
import type { SongStatusController } from '@/lib/songStatus'

export interface SongIdentityHeaderProps {
  identity: SongIdentity
  status: SongStatusController
  /** Forwarded to `StatusNotes`: the page's offline signal (RH-80). */
  readOnly?: boolean
}

/**
 * The "Song details" section: the title, the optional artist line, the optional
 * key line and the four-note mastery control.
 *
 * Presentational only — the three fields come from `songIdentity()` and the
 * status write belongs to `useSongStatus` (RH-52). The notes render at the Fast
 * View size, the comfortable standing-up target, with `busy` bound to the
 * in-flight write so a tap visibly landed while the Server Action runs
 * (RH-102).
 */
export function SongIdentityHeader({ identity, status, readOnly = false }: SongIdentityHeaderProps) {
  return (
    <section aria-label="Song details" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 leading-tight">{identity.title}</h1>
          {identity.artist && (
            <p className="mt-1 text-lg text-gray-500">{identity.artist}</p>
          )}
        </div>
        <div className="shrink-0 mt-1">
          <StatusNotes
            status={status.status}
            onChange={(next) => {
              status.change(next).catch(() => undefined)
            }}
            size="stage"
            readOnly={readOnly}
            busy={status.updating}
          />
        </div>
      </div>

      {identity.key && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">Key:</span> {identity.key}
        </p>
      )}
    </section>
  )
}

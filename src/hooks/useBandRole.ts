import { useEffect, useState } from 'react'

export type BandRole = 'admin' | 'member'

/**
 * RH-96 — the caller's role in the active band, or `null` when there is no
 * band context, while the read is in flight, and after it is refused.
 *
 * A client island's band comes from `localStorage`, so the Server Component
 * page that renders it cannot resolve the role and pass it down; it injects the
 * read instead (F21), and this hook owns the one call per band. `null` is the
 * closed state on purpose: a caller only gets an authoring control once the
 * server has said `admin`, which is the same answer the gate on the write will
 * give. A refusal (not a member of that band) is an answer, not an error to
 * surface — the context is the caller's own stale `localStorage`, and every
 * other read for that band fails loudly already.
 */
export function useBandRole(
  bandId: string | null,
  getBandRole: (bandId: string) => Promise<BandRole>,
): BandRole | null {
  // The band is stored with the role so a context switch cannot show the old
  // band's answer for the new one, and so the effect never has to write state
  // synchronously to clear it (`react-hooks/set-state-in-effect`).
  const [resolved, setResolved] = useState<{ bandId: string; role: BandRole } | null>(null)

  useEffect(() => {
    if (!bandId) return
    let active = true
    getBandRole(bandId)
      .then((role) => {
        if (active) setResolved({ bandId, role })
      })
      .catch(() => {
        if (active) setResolved(null)
      })
    return () => {
      active = false
    }
  }, [bandId, getBandRole])

  return resolved?.bandId === bandId ? resolved.role : null
}

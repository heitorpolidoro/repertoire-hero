'use client'

import { useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { getBandsAction } from '@/app/actions/bands'
import { getProfileAction } from '@/app/actions/profile'
import ConditionalLayout from '@/components/layout/ConditionalLayout'
import { SetlistPlayer } from '@/components/layout/SetlistPlayer'
import { SETLIST_PLAYER_ACTIONS } from '@/app/setlistPlayerActions'
import { useOfflineStatus } from '@/hooks/useOfflineStatus'
import { useSetlistPlayer } from '@/hooks/useSetlistPlayer'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'
import { reconcileBandContext } from '@/lib/bandContext'
import { logger } from '@/lib/logger'
import type { BandIndicatorCopy, Locale } from '@/lib/i18n'
import type { BandOption } from '@/types/database'

/**
 * The client shell that owns the app chrome's data (RH-46).
 *
 * `AppLayout` and the `ContextSwitcher` inside it are presentational: they take
 * the band list as a prop. This component is the one place in the App Router
 * tree that fetches it, and it also carries the band-context reconciliation
 * that used to live in `ContextSwitcher`'s mount effect.
 *
 * `AppShell` is not a reserved App Router filename, so it declares no route.
 */
export default function AppShell({
  children,
  bandIndicatorCopies,
}: {
  children: React.ReactNode
  bandIndicatorCopies: Record<Locale, BandIndicatorCopy>
}) {
  const { data: session } = authClient.useSession()
  const userId = session?.user?.id ?? null
  const [bands, setBands] = useState<BandOption[]>([])
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getBandsAction()
      .then((fetched) => {
        if (cancelled) return
        setBands(fetched)
        applyBandContextDecision(fetched)
      })
      .catch((error: unknown) => {
        // P1: a failed fetch is not an authoritative band list, so the
        // persisted context is left exactly as it was — reconciling against an
        // empty or partial result would reset a context that is still valid.
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to load bands for context reconciliation', err, { userId })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // RH-156: the Catalog nav entry is cosmetic - /admin/catalog gates itself - so
  // a failed profile read simply leaves it hidden.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getProfileAction()
      .then((profile) => {
        if (!cancelled) setIsSystemAdmin(profile?.is_system_admin === true)
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to load profile for the Catalog nav entry', err, { userId })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // RH-167: the setlist player lives here, above every route, so its audio and
  // YouTube nodes survive navigation. Hidden until a "Play setlist" tap.
  const setlistPlayer = useSetlistPlayer({
    actions: SETLIST_PLAYER_ACTIONS,
    offline: useOfflineStatus(),
    enabled: !!userId,
  })

  return (
    <>
      <ConditionalLayout
        bands={bands}
        isSystemAdmin={!!userId && isSystemAdmin}
        bandIndicatorCopies={bandIndicatorCopies}
      >
        {children}
      </ConditionalLayout>
      <SetlistPlayer {...setlistPlayer} />
    </>
  )
}

/**
 * Applies the RH-98 reconciliation to the persisted context.
 *
 * `reset` is the branch that used to be missing: a context pointing at a band
 * the user has left, was removed from, or that was deleted survived in
 * `localStorage`, and every band-scoped read and write then failed server-side
 * with `Access denied: not a member of this band`. The reload swaps the gone
 * band's rows (or the failed band read) for the personal repertoire; the user
 * is deliberately not navigated anywhere.
 */
function applyBandContextDecision(fetched: BandOption[]): void {
  const store = useBandContextStore.getState()
  const decision = reconcileBandContext(store.context, fetched)

  if (decision.action === 'refresh') {
    store.setBandContext(decision.id, decision.name, decision.color)
    return
  }

  if (decision.action === 'reset') {
    store.setUserContext()
    void useRepertoireStore.getState().loadSongs()
  }
}

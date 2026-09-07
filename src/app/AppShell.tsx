'use client'

import { useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { getBandsAction } from '@/app/actions/bands'
import ConditionalLayout from '@/components/layout/ConditionalLayout'
import { useBandContextStore } from '@/store/bandContextStore'
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
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
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession()
  const userId = session?.user?.id ?? null
  const [bands, setBands] = useState<BandOption[]>([])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getBandsAction().then((fetched) => {
      if (cancelled) return
      setBands(fetched)
      // Moved verbatim from ContextSwitcher: keep the persisted band context's
      // name/colour in step with the row the database actually holds.
      const currentCtx = useBandContextStore.getState().context
      if (currentCtx.type === 'band') {
        const activeBand = fetched.find((x) => x.id === currentCtx.id)
        if (activeBand) {
          const dbColor = activeBand.color ?? DEFAULT_BAND_COLOR
          if (currentCtx.color !== dbColor || currentCtx.name !== activeBand.name) {
            useBandContextStore.getState().setBandContext(activeBand.id, activeBand.name, dbColor)
          }
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  return <ConditionalLayout bands={bands}>{children}</ConditionalLayout>
}

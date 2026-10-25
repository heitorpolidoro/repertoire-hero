import { useRouter } from 'next/navigation'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'

export type ContextTarget =
  | { type: 'user' }
  | { type: 'band'; id: string; name: string; color?: string }

export interface ContextSwitchController {
  switchTo: (target: ContextTarget) => void
}

/**
 * RH-181 — the one context switch routine. The desktop sidebar switcher, the
 * mobile sheet and the band bar's Exit all call it, so a switch made on any of
 * them writes the same persisted `band-context` store, reloads the songs for
 * the new owner and returns to the repertoire home.
 */
export function useContextSwitch(): ContextSwitchController {
  const router = useRouter()
  const setUserContext = useBandContextStore((s) => s.setUserContext)
  const setBandContext = useBandContextStore((s) => s.setBandContext)
  const loadSongs = useRepertoireStore((s) => s.loadSongs)

  const switchTo = (target: ContextTarget) => {
    if (target.type === 'user') setUserContext()
    else setBandContext(target.id, target.name, target.color)
    loadSongs()
    router.push('/')
  }

  return { switchTo }
}

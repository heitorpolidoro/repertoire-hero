import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type BandContext =
  | { type: 'user' }
  | { type: 'band'; id: string; name: string }

interface BandContextState {
  context: BandContext
  setUserContext: () => void
  setBandContext: (id: string, name: string) => void
  isPersonal: () => boolean
  bandId: () => string | null
}

export const useBandContextStore = create<BandContextState>()(
  persist(
    (set, get) => ({
      context: { type: 'user' },

      setUserContext: () => set({ context: { type: 'user' } }),

      setBandContext: (id: string, name: string) =>
        set({ context: { type: 'band', id, name } }),

      isPersonal: () => get().context.type === 'user',

      bandId: () => {
        const ctx = get().context
        return ctx.type === 'band' ? ctx.id : null
      },
    }),
    { name: 'band-context' }
  )
)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/hooks/useToast'
import type { CatalogSearchResult } from '@/types/database'
import type { BlastRadius } from '@/lib/catalogAdmin'
import type { CatalogAdminActions, RadiusState } from '@/lib/catalogAdminPlan'

/** The one flow open at a time; every flow ends in a ConfirmPanel before it mutates. */
export type CatalogFlow =
  | { kind: 'mergeVersions'; songId: string; fromId: string; intoId: string; confirming: boolean }
  | {
      kind: 'split'
      songId: string
      chosen: string[]
      mode: 'new' | 'existing'
      artist: string
      title: string
      existingSongId: string
      confirming: boolean
    }
  | { kind: 'mergeSongs'; songId: string; intoSongId: string; confirming: boolean }
  | { kind: 'delete'; songId: string; versionId: string }

export interface CatalogAdminController {
  openSongIds: string[]
  radii: Record<string, RadiusState>
  songRadius: RadiusState | null
  flow: CatalogFlow | null
  busy: boolean
  error: string | null
  toast: ReturnType<typeof useToast>['toast']
  dismissToast: () => void
  dismissError: () => void
  toggleSong: (song: CatalogSearchResult) => void
  startMergeVersions: (song: CatalogSearchResult, fromId: string) => void
  startSplit: (song: CatalogSearchResult) => void
  startMergeSongs: (song: CatalogSearchResult) => void
  startDelete: (song: CatalogSearchResult, versionId: string) => void
  patchFlow: (patch: Partial<CatalogFlow>) => void
  toggleChosen: (versionId: string) => void
  review: () => void
  cancel: () => void
  confirm: () => void
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : undefined) || 'The operation failed'
}

/**
 * Controller for the /admin/catalog island (RH-156): the blast radius of each
 * opened song's versions, the single open flow, and the confirm-then-run step
 * that calls an injected action and then `router.refresh()`. It imports no
 * Server Action; the page hands them in.
 */
export function useCatalogAdmin(actions: CatalogAdminActions): CatalogAdminController {
  const router = useRouter()
  const { toast, showToast, dismissToast } = useToast()
  const [openSongIds, setOpenSongIds] = useState<string[]>([])
  const [radii, setRadii] = useState<Record<string, RadiusState>>({})
  const [songRadius, setSongRadius] = useState<RadiusState | null>(null)
  const [flow, setFlow] = useState<CatalogFlow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadVersionRadius = (versionId: string) => {
    setRadii((prev) => ({ ...prev, [versionId]: { status: 'loading' } }))
    actions
      .getBlastRadius({ versionId })
      .then((radius: BlastRadius) =>
        setRadii((prev) => ({ ...prev, [versionId]: { status: 'ready', radius } })),
      )
      .catch((err: unknown) =>
        setRadii((prev) => ({
          ...prev,
          [versionId]: { status: 'error', message: messageOf(err) },
        })),
      )
  }

  const toggleSong = (song: CatalogSearchResult) => {
    if (openSongIds.includes(song.id)) {
      setOpenSongIds(openSongIds.filter((id) => id !== song.id))
      setFlow((f) => (f?.songId === song.id ? null : f))
      return
    }
    setOpenSongIds([...openSongIds, song.id])
    for (const v of song.versions) {
      if (!radii[v.versionId]) loadVersionRadius(v.versionId)
    }
  }

  const begin = (next: CatalogFlow) => {
    setError(null)
    setSongRadius(null)
    setFlow(next)
  }

  const startMergeVersions = (song: CatalogSearchResult, fromId: string) =>
    begin({ kind: 'mergeVersions', songId: song.id, fromId, intoId: '', confirming: false })

  const startSplit = (song: CatalogSearchResult) =>
    begin({
      kind: 'split',
      songId: song.id,
      chosen: [],
      mode: 'new',
      artist: song.artist,
      title: song.title,
      existingSongId: '',
      confirming: false,
    })

  const startMergeSongs = (song: CatalogSearchResult) =>
    begin({ kind: 'mergeSongs', songId: song.id, intoSongId: '', confirming: false })

  const startDelete = (song: CatalogSearchResult, versionId: string) =>
    begin({ kind: 'delete', songId: song.id, versionId })

  const patchFlow = (patch: Partial<CatalogFlow>) =>
    setFlow((f) => (f ? ({ ...f, ...patch } as CatalogFlow) : f))

  const toggleChosen = (versionId: string) =>
    setFlow((f) => {
      if (f?.kind !== 'split') return f
      const chosen = f.chosen.includes(versionId)
        ? f.chosen.filter((id) => id !== versionId)
        : [...f.chosen, versionId]
      return { ...f, chosen, confirming: false }
    })

  const review = () => {
    if (!flow || flow.kind === 'delete') return
    if (flow.kind === 'mergeSongs') {
      setSongRadius({ status: 'loading' })
      actions
        .getBlastRadius({ songId: flow.songId })
        .then((radius: BlastRadius) => setSongRadius({ status: 'ready', radius }))
        .catch((err: unknown) => setSongRadius({ status: 'error', message: messageOf(err) }))
    }
    setFlow({ ...flow, confirming: true })
  }

  const cancel = () => {
    setSongRadius(null)
    setFlow(null)
  }

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setFlow(null)
      setSongRadius(null)
      setRadii({})
      setOpenSongIds([])
      showToast(done, 'success')
      router.refresh()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const confirm = () => {
    if (!flow || busy) return
    if (flow.kind === 'mergeVersions') {
      void run(() => actions.mergeSongVersions(flow.fromId, flow.intoId), 'Versions merged')
    } else if (flow.kind === 'split') {
      const target =
        flow.mode === 'new'
          ? { new: { artist: flow.artist.trim(), title: flow.title.trim() } }
          : { songId: flow.existingSongId }
      void run(() => actions.splitSongVersions(flow.songId, flow.chosen, target), 'Versions split')
    } else if (flow.kind === 'mergeSongs') {
      void run(() => actions.mergeSongs(flow.songId, flow.intoSongId), 'Songs merged')
    } else {
      void run(() => actions.deleteSongVersion(flow.versionId), 'Version deleted')
    }
  }

  return {
    openSongIds,
    radii,
    songRadius,
    flow,
    busy,
    error,
    toast,
    dismissToast,
    dismissError: () => setError(null),
    toggleSong,
    startMergeVersions,
    startSplit,
    startMergeSongs,
    startDelete,
    patchFlow,
    toggleChosen,
    review,
    cancel,
    confirm,
  }
}

import { useState } from 'react'
import {
  buildPickedQueue,
  pickedFastViewHref,
  togglePick,
  type PickRow,
} from '@/lib/pickedSelection'
import { writeSongQueue, type SongQueueOwner } from '@/lib/songQueue'

export interface UsePickedSelectionOptions {
  /** Every row on the screen, unfiltered: hidden rows stay in the selection. */
  rows: readonly PickRow[]
  owner: SongQueueOwner
  /** The picker screen: where Back from Fast View goes. */
  originHref: string
  /** The router's `push`. */
  push: (href: string) => void
}

export interface PickedSelectionController {
  active: boolean
  count: number
  canStart: boolean
  isPicked: (versionId: string) => boolean
  /** 1-based pick number, or `null` when unpicked. */
  pickNumber: (versionId: string) => number | null
  enter: () => void
  toggle: (versionId: string) => void
  confirm: () => void
  cancel: () => void
}

/**
 * RH-170 - the "Select songs" controller shared by the band screen and the
 * dashboard. Writes only the `sessionStorage` queue: no server call, no
 * `last_practiced`, no status. Cancel touches no storage at all.
 */
export function usePickedSelection({
  rows,
  owner,
  originHref,
  push,
}: UsePickedSelectionOptions): PickedSelectionController {
  const [active, setActive] = useState(false)
  const [picks, setPicks] = useState<string[]>([])

  const leave = () => {
    setActive(false)
    setPicks([])
  }

  const confirm = () => {
    const rowsById = new Map(rows.map((row) => [row.versionId, row]))
    const queue = buildPickedQueue(picks, rowsById, owner, originHref)
    const href = pickedFastViewHref(queue)
    if (!href) return
    writeSongQueue(queue)
    leave()
    push(href)
  }

  return {
    active,
    count: picks.length,
    canStart: picks.length > 0,
    isPicked: (id) => picks.includes(id),
    pickNumber: (id) => {
      const index = picks.indexOf(id)
      return index === -1 ? null : index + 1
    },
    enter: () => {
      setPicks([])
      setActive(true)
    },
    toggle: (id) => setPicks((current) => togglePick(current, id)),
    confirm,
    cancel: leave,
  }
}

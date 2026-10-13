import { getRepertoireAction, recordPracticeAction } from '@/app/actions/repertoire'
import type { PracticeFinishActions } from '@/hooks/usePracticeFinish'

/**
 * RH-169: the owner's levels and the batched practice write behind Fast View's
 * "Finish practice". Not offline-first: the control is hidden offline, because
 * the write needs the network. Module-level so the identity is stable (F21).
 */
export const PRACTICE_FINISH_ACTIONS: PracticeFinishActions = {
  getRepertoire: getRepertoireAction,
  recordPractice: recordPracticeAction,
}

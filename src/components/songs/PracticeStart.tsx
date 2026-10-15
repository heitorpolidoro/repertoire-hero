"use client";

import { useRouter } from "next/navigation";
import {
  usePracticeStart,
  type PracticeActions,
  type PracticeChoice,
} from "@/hooks/usePracticeStart";
import { PracticeStartButton } from "@/components/songs/PracticeStartButton";

export interface PracticeStartProps {
  bandId: string | null;
  actions: PracticeActions;
  /** RH-172: start this source at once instead of opening the source menu. */
  fixedChoice?: PracticeChoice;
  /** RH-172: where Back from Fast View returns; default is derived from the owner. */
  originHref?: string;
}

/**
 * RH-168 - mount point for every screen: binds the controller to the router and
 * renders the button. `bandId` null starts from the personal repertoire.
 */
export function PracticeStart({ bandId, actions, fixedChoice, originHref }: PracticeStartProps) {
  const router = useRouter();
  const practice = usePracticeStart({ bandId, actions, push: router.push, fixedChoice, originHref });
  return <PracticeStartButton practice={practice} />;
}

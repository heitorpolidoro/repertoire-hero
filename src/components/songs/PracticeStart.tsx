"use client";

import { useRouter } from "next/navigation";
import { usePracticeStart, type PracticeActions } from "@/hooks/usePracticeStart";
import { PracticeStartButton } from "@/components/songs/PracticeStartButton";

/**
 * RH-168 - mount point for both screens: binds the controller to the router and
 * renders the button. `bandId` null starts from the personal repertoire.
 */
export function PracticeStart({ bandId, actions }: { bandId: string | null; actions: PracticeActions }) {
  const router = useRouter();
  const practice = usePracticeStart({ bandId, actions, push: router.push });
  return <PracticeStartButton practice={practice} />;
}

"use client";

import { useState } from "react";
import type { SuggestionOutcomeCopy } from "@/lib/i18n";
import type { SuggestionOutcome, SuggestionOutcomeGroup } from "@/types/database";

/**
 * RH-111 — what became of the requester's corrections, per field.
 *
 * Presentational: the acknowledge Server Action is injected by `src/app/page.tsx`
 * (F21), and the copy arrives as a prop resolved on the server, so this file
 * reads no dictionary. A `replaced` field is told as replaced — never as refused
 * — and never shows a reason; only a `refused` field with a reason does.
 *
 * Dismissing acknowledges exactly the ids it lists. If the call fails the banner
 * stays put, so the requester can try again rather than silently losing it.
 */
export interface SuggestionOutcomeBannerActions {
  acknowledge: (ids: string[]) => Promise<unknown>;
}

interface SuggestionOutcomeBannerProps {
  groups: SuggestionOutcomeGroup[];
  copy: SuggestionOutcomeCopy;
  actions: SuggestionOutcomeBannerActions;
}

/** One tone per outcome, so the three read differently at a glance. */
const OUTCOME_TONE: Record<SuggestionOutcome, string> = {
  approved: "text-emerald-700",
  refused: "text-red-700",
  replaced: "text-gray-600",
};

function fieldLabel(copy: SuggestionOutcomeCopy, column: string): string {
  const labels: Record<string, string> = copy.fields;
  return labels[column] ?? column;
}

export default function SuggestionOutcomeBanner({
  groups,
  copy,
  actions,
}: SuggestionOutcomeBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || groups.length === 0) return null;

  const ids = groups.flatMap((group) => group.fields.map((field) => field.id));

  async function dismiss() {
    try {
      await actions.acknowledge(ids);
      setDismissed(true);
    } catch {
      // Best-effort: the banner stays visible, which is the retry affordance.
    }
  }

  return (
    <section
      role="status"
      aria-label={copy.title}
      className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 md:mx-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{copy.title}</h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label={copy.dismiss}
          className="text-xs text-gray-400 hover:text-gray-600 focus:outline-none"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 space-y-3">
        {groups.map((group) => (
          <div key={group.group_id}>
            <p className="text-sm font-medium text-gray-800">
              {group.title} — {group.artist}
            </p>
            <ul className="mt-1 space-y-1">
              {group.fields.map((field) => (
                <li
                  key={field.id}
                  data-testid={`outcome-${field.id}`}
                  className={`text-sm ${OUTCOME_TONE[field.outcome]}`}
                >
                  <span className="font-medium">{fieldLabel(copy, field.column)}:</span>{" "}
                  {copy[field.outcome]}
                  {field.reason && (
                    <span className="block text-xs text-gray-600">
                      {copy.reasonLabel} {field.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
      >
        {copy.gotIt}
      </button>
    </section>
  );
}

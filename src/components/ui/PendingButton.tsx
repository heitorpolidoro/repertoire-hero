"use client";

import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "@/components/ui/Spinner";

export interface PendingButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "disabled"> {
  pending: boolean;
  label: string;
  pendingLabel: string;
  /** The spinner's color, e.g. `text-white` on a filled emerald button. */
  spinnerClassName?: string;
}

/**
 * A button that disables itself while `pending` and swaps its label for a
 * spinner plus `pendingLabel`, so a slow write never looks like a click that
 * did nothing and cannot be fired twice.
 */
export function PendingButton({
  pending,
  label,
  pendingLabel,
  spinnerClassName,
  className = "",
  ...rest
}: PendingButtonProps) {
  return (
    <button {...rest} disabled={pending} aria-busy={pending} className={`flex items-center gap-1.5 ${className}`}>
      {pending ? (
        <>
          <Spinner colorClassName={spinnerClassName} />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}

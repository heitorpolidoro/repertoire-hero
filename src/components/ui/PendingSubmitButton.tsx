"use client";

import { useFormStatus } from "react-dom";
import { PendingButton } from "@/components/ui/PendingButton";

export interface PendingSubmitButtonProps {
  label: string;
  /** Shown next to the spinner while the enclosing form's action runs. */
  pendingLabel: string;
  className?: string;
  spinnerClassName?: string;
}

/**
 * The submit button of a Server Action `<form action={...}>` rendered by a
 * Server Component: `useFormStatus` needs a client component inside the form,
 * and without it the button gives no sign that the action (and the redirect
 * that usually follows) is still running.
 */
export function PendingSubmitButton(props: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();
  return <PendingButton type="submit" pending={pending} {...props} />;
}

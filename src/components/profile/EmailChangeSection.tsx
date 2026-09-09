"use client";

import { useState } from "react";
import { AlertBanner } from "@/components/ui/AlertBanner";

/**
 * The Server Action this island calls, injected by `src/app/profile/page.tsx`
 * rather than imported, so `src/components` never points back into `src/app` (F21).
 */
export interface EmailChangeActions {
  requestEmailChange: (newEmail: string) => Promise<void>;
}

interface EmailChangeSectionProps {
  /** The address the account signs in with today, read from the profile row. */
  currentEmail: string;
  actions: EmailChangeActions;
}

/**
 * RH-42 — the email section of `/profile`.
 *
 * Before RH-42 this markup promised a confirmation mail that no code path ever
 * sent, while the address had in fact already been rewritten by the time the
 * banner appeared. Now the promise is true: the request only asks Better Auth
 * to send a link, and the login identity moves at `/api/auth/verify-email`,
 * not here.
 *
 * The pending state is client-only and deliberately not persisted: the token is
 * a signed JWT and no table holds an in-flight change, so there is nothing to
 * read back. After a reload the section is idle again and shows the address
 * that is still current; once the link is opened Better Auth redirects here
 * (the `callbackURL`) with a refreshed session, and the new address appears
 * because the page reads the trigger-synced `profiles` row.
 *
 * The copy is identical whether or not the address already belongs to another
 * account - Better Auth answers the taken case with a silent success and sends
 * nothing, and a distinguishable message here would give back the account
 * enumeration the server side is careful not to leak.
 */
export function EmailChangeSection({ currentEmail, actions }: EmailChangeSectionProps) {
  const [value, setValue] = useState(currentEmail);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const submittable = trimmed !== "" && trimmed !== currentEmail;

  const handleSubmit = async () => {
    if (!submittable) return;
    setSending(true);
    setError(null);
    setSentTo(null);
    try {
      await actions.requestEmailChange(trimmed);
      setSentTo(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request email change");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-gray-700">Email</h2>
      {error && (
        <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />
      )}
      <div className="flex gap-2">
        <label htmlFor="email" className="sr-only">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={() => {
            handleSubmit();
          }}
          disabled={sending || !submittable}
          className="shrink-0 px-4 py-2 rounded-md bg-gray-800 text-white text-sm font-medium hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Sending..." : "Change"}
        </button>
      </div>

      {sentTo ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-emerald-700">Confirmation link sent to {sentTo}. Your sign-in address is still {currentEmail} and only changes when you open that link.</p>
          <p className="text-xs text-gray-400">If it does not arrive, check your spam folder and try again.</p>
        </div>
      ) : (
        submittable && (
          <p className="text-xs text-amber-600">We will email a confirmation link to {trimmed}. Your sign-in address stays {currentEmail} until you open it.</p>
        )
      )}
    </section>
  );
}

'use client'

/**
 * The read-only strip the Fast View shows while the browser has no network
 * (RH-80).
 *
 * Presentational: the page owns the single `useOfflineStatus()` call and simply
 * does not render this while online, so there is nothing to test through a
 * browser signal (RH-38/RH-52).
 *
 * The copy is inline English, not a dictionary key: AGENTS.md (F25) scopes i18n
 * to the landing page and writes application copy inline.
 */
export function OfflineBanner() {
  return (
    <div
      role="status"
      data-testid="offline-read-only-banner"
      className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 shadow-sm"
    >
      <span aria-hidden="true">📴</span>
      <span>
        <span className="font-semibold">You are offline.</span> This song is read-only until you
        reconnect.
      </span>
    </div>
  )
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/Spinner';
import { authClient } from '@/lib/auth-client';
import { OFFLINE_STORE } from '@/lib/offlineStore';
import { useBandContextStore } from '@/store/bandContextStore';

/**
 * The sign-out sequence (RH-79).
 *
 * Outside `AppLayout`, taking the router structurally, for two reasons: the
 * purge has to be awaited *first*, and `AppLayout` sits at its line budgets, so
 * adding these lines in place would break the complexity budget.
 *
 * `clearAllOfflineData()` runs before the context reset and before
 * `authClient.signOut()`, and is awaited, because the offline cache answers
 * before the network and therefore bypasses `src/proxy.ts`'s redirect entirely:
 * a snapshot left on the device would still be readable by whoever signs in
 * next. It never throws, so a purge failure cannot strand the user signed in.
 */
async function signOutAndPurge(router: { push: (href: string) => void }): Promise<void> {
  await OFFLINE_STORE.clearAllOfflineData();
  useBandContextStore.getState().setUserContext();
  await authClient.signOut();
  router.push('/login');
}

interface SignOutButtonProps {
  className: string;
  iconClassName?: string;
}

/**
 * The Sign Out button of both navs. It owns its pending state because the purge
 * can take a while with large offline playlists cached: the icon becomes a
 * spinner and the button disables itself, so a slow sign-out never looks like a
 * click that did nothing, and cannot run twice.
 */
export function SignOutButton({ className, iconClassName }: SignOutButtonProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleClick = () => {
    setSigningOut(true);
    signOutAndPurge(router).catch(() => setSigningOut(false));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={signingOut}
      aria-busy={signingOut}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {signingOut ? (
        <span className={iconClassName}><Spinner /></span>
      ) : (
        <span className={iconClassName} aria-hidden="true">🚪</span>
      )}
      {signingOut ? 'Signing out…' : 'Sign Out'}
    </button>
  );
}

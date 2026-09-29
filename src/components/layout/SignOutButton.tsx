'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/Spinner';
import { authClient } from '@/lib/auth-client';
import { useBandContextStore } from '@/store/bandContextStore';

/** The sign-out sequence: reset the context, end the session, go to login. */
async function signOut(router: { push: (href: string) => void }): Promise<void> {
  useBandContextStore.getState().setUserContext();
  await authClient.signOut();
  router.push('/login');
}

interface SignOutButtonProps {
  className: string;
  iconClassName?: string;
}

/**
 * The Sign Out button of both navs. It owns its pending state: while the
 * session ends, the icon becomes a spinner and the button disables itself, so a slow sign-out never looks like a
 * click that did nothing, and cannot run twice.
 */
export function SignOutButton({ className, iconClassName }: SignOutButtonProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleClick = () => {
    setSigningOut(true);
    signOut(router).catch(() => setSigningOut(false));
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

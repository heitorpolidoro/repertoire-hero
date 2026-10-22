'use client';

import { usePathname } from 'next/navigation';
import AppLayout from './AppLayout';
import type { BandIndicatorCopy, Locale } from '@/lib/i18n';
import type { BandOption } from '@/types/database';

interface ConditionalLayoutProps {
  children: React.ReactNode;
  bands: BandOption[];
  isSystemAdmin?: boolean;
  bandIndicatorCopies: Record<Locale, BandIndicatorCopy>;
}

/**
 * Renders AppLayout for all authenticated routes.
 * Routes that start with /login bypass the app shell entirely.
 */
export default function ConditionalLayout({
  children,
  bands,
  isSystemAdmin,
  bandIndicatorCopies,
}: ConditionalLayoutProps) {
  const pathname = usePathname();

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/join/')
  ) {
    return children;
  }

  return (
    <AppLayout bands={bands} isSystemAdmin={isSystemAdmin} bandIndicatorCopies={bandIndicatorCopies}>
      {children}
    </AppLayout>
  );
}

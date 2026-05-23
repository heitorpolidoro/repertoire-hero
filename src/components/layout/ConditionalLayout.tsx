'use client';

import { usePathname } from 'next/navigation';
import AppLayout from './AppLayout';

interface ConditionalLayoutProps {
  children: React.ReactNode;
}

/**
 * Renders AppLayout for all authenticated routes.
 * Routes that start with /login bypass the app shell entirely.
 */
export default function ConditionalLayout({ children }: ConditionalLayoutProps) {
  const pathname = usePathname();

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/join/')
  ) {
    return children;
  }

  return <AppLayout>{children}</AppLayout>;
}

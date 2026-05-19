'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Repertoire', href: '/', icon: '🎵' },
  { label: 'Playlists', href: '/playlists', icon: '🎶' },
  { label: 'Bands', href: '/bands', icon: '🎸' },
  { label: 'Profile', href: '/profile', icon: '👤' },
];

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = async (): Promise<void> => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <nav
        aria-label="Main navigation"
        className="hidden md:flex flex-col w-60 bg-gray-900 text-white shrink-0"
      >
        <div className="px-6 py-5 border-b border-gray-700">
          <span className="text-lg font-semibold tracking-tight">Repertoire Hero</span>
        </div>

        <ul className="flex-1 flex flex-col gap-1 px-3 py-4" role="list">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-emerald-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="px-3 py-4 border-t border-gray-700">
          <p className="px-3 pb-3 text-xs text-gray-500">
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <span aria-hidden="true">🚪</span>
            Sign Out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main navigation"
        className="md:hidden fixed bottom-0 inset-x-0 bg-gray-900 text-white border-t border-gray-700 z-10"
      >
        <ul className="flex" role="list">
          {NAV_ITEMS.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                  isActive(item.href)
                    ? 'text-emerald-400'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          ))}

          <li className="flex-1">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full flex-col items-center gap-0.5 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors"
            >
              <span className="text-xl leading-none" aria-hidden="true">
                🚪
              </span>
              Sign Out
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

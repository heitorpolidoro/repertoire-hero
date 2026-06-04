'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { getBandsAction } from '@/app/actions/bands';
import { useBandContextStore } from '@/store/bandContextStore';
import { useRepertoireStore } from '@/store/repertoireStore';

interface Band {
  id: string;
  name: string;
  role: 'admin' | 'member';
}

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

function ContextSwitcher() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const user = session?.user ?? null;
  const { context, setUserContext, setBandContext } = useBandContextStore();
  const loadSongs = useRepertoireStore((s) => s.loadSongs);

  const [bands, setBands] = useState<Band[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getBandsAction().then((b) => setBands(b as unknown as Band[]));
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchContext = (next: { type: 'user' } | { type: 'band'; id: string; name: string }) => {
    if (next.type === 'user') setUserContext();
    else setBandContext(next.id, next.name);
    setOpen(false);
    loadSongs();
    router.push('/');
  };

  if (!user) return null;

  const label = context.type === 'band'
    ? context.name
    : (user.name ?? user.email?.split('@')[0] ?? 'Pessoal');

  return (
    <div className="px-3 py-3 border-b border-gray-700" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 rounded-md bg-gray-800 hover:bg-gray-700 transition-colors text-left"
      >
        <span className="text-base leading-none">
          {context.type === 'band' ? '🎸' : '👤'}
        </span>
        <span className="flex-1 text-sm font-medium text-white truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-1 bg-gray-800 rounded-md border border-gray-600 overflow-hidden shadow-lg">
          {/* Personal */}
          <button
            onClick={() => switchContext({ type: 'user' })}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 transition-colors ${context.type === 'user' ? 'text-emerald-400' : 'text-gray-300'}`}
          >
            <span>👤</span>
            <span className="truncate">{user.name ?? user.email?.split('@')[0]}</span>
            {context.type === 'user' && <span className="ml-auto text-xs">✓</span>}
          </button>

          {bands.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs text-gray-500 uppercase tracking-wider border-t border-gray-700">
                Bandas
              </div>
              {bands.map((band) => (
                <button
                  key={band.id}
                  onClick={() => switchContext({ type: 'band', id: band.id, name: band.name })}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 transition-colors ${context.type === 'band' && context.id === band.id ? 'text-emerald-400' : 'text-gray-300'}`}
                >
                  <span>🎸</span>
                  <span className="truncate">{band.name}</span>
                  {context.type === 'band' && context.id === band.id && <span className="ml-auto text-xs">✓</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {context.type === 'band' && (
        <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 bg-purple-900/40 border border-purple-700/50 rounded text-xs text-purple-300">
          <span>🎸</span>
          <span className="truncate">Modo banda</span>
          <button onClick={() => switchContext({ type: 'user' })} className="ml-auto hover:text-white">✕</button>
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = async (): Promise<void> => {
    useBandContextStore.getState().setUserContext();
    await authClient.signOut();
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

        <ContextSwitcher />

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
              <span className="text-xl leading-none" aria-hidden="true">🚪</span>
              Sign Out
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

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
  { label: 'Settings', href: '/settings', icon: '⚙️' },
];

interface AppLayoutProps {
  children: React.ReactNode;
}

interface ContextSwitcherProps {
  isBandMode: boolean;
}

function ContextSwitcher({ isBandMode }: ContextSwitcherProps) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const user = session?.user ?? null;
  const { context, setUserContext, setBandContext } = useBandContextStore();
  const loadSongs = useRepertoireStore((s) => s.loadSongs);

  const [mounted, setMounted] = useState(false);
  const [bands, setBands] = useState<Band[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

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

  if (!mounted || !user) return null;

  const label = context.type === 'band'
    ? context.name
    : (user.name ?? user.email?.split('@')[0] ?? 'Personal');

  return (
    <div className="px-3 py-3 border-b border-purple-700/50" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 px-3 py-2 rounded-md transition-colors text-left ${
          isBandMode
            ? 'bg-purple-800/60 hover:bg-purple-700/60 ring-1 ring-purple-500/50'
            : 'bg-gray-800 hover:bg-gray-700'
        }`}
      >
        <span className="text-base leading-none">
          {context.type === 'band' ? '🎸' : '👤'}
        </span>
        <span className="flex-1 text-sm font-medium text-white truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''} ${isBandMode ? 'text-purple-300' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`mt-1 rounded-md border overflow-hidden shadow-lg ${isBandMode ? 'bg-purple-900 border-purple-600' : 'bg-gray-800 border-gray-600'}`}>
          {/* Personal */}
          <button
            onClick={() => switchContext({ type: 'user' })}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              context.type === 'user'
                ? 'text-emerald-400'
                : isBandMode ? 'text-purple-200 hover:bg-purple-800' : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span>👤</span>
            <span className="truncate">{user.name ?? user.email?.split('@')[0]}</span>
            {context.type === 'user' && <span className="ml-auto text-xs">✓</span>}
          </button>

          {bands.length > 0 && (
            <>
              <div className={`px-3 py-1 text-xs uppercase tracking-wider border-t ${isBandMode ? 'text-purple-400 border-purple-700' : 'text-gray-500 border-gray-700'}`}>
                Bands
              </div>
              {bands.map((band) => (
                <button
                  key={band.id}
                  onClick={() => switchContext({ type: 'band', id: band.id, name: band.name })}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    context.type === 'band' && context.id === band.id
                      ? 'text-purple-300'
                      : isBandMode ? 'text-purple-200 hover:bg-purple-800' : 'text-gray-300 hover:bg-gray-700'
                  }`}
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
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const context = useBandContextStore((s) => s.context);
  const { setUserContext } = useBandContextStore();
  const loadSongs = useRepertoireStore((s) => s.loadSongs);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Guard against hydration mismatch — persisted store might differ from SSR default
  const isBandMode = mounted && context.type === 'band';
  const bandName = context.type === 'band' ? context.name : '';

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = async (): Promise<void> => {
    useBandContextStore.getState().setUserContext();
    await authClient.signOut();
    router.push('/login');
  };

  const handleExitBandMode = () => {
    setUserContext();
    loadSongs();
    router.push('/');
  };

  const activeNavClass = isBandMode
    ? 'bg-purple-600 text-white'
    : 'bg-emerald-600 text-white';

  const inactiveNavClass = isBandMode
    ? 'text-purple-200 hover:bg-purple-800/60 hover:text-white'
    : 'text-gray-300 hover:bg-gray-700 hover:text-white';

  const sidebarBg = isBandMode ? 'bg-purple-950' : 'bg-gray-900';
  const borderColor = isBandMode ? 'border-purple-700/50' : 'border-gray-700';

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <nav
        aria-label="Main navigation"
        className={`hidden md:flex flex-col w-60 ${sidebarBg} text-white shrink-0 transition-colors duration-200`}
      >
        {/* Header */}
        <div className={`px-6 py-5 border-b ${borderColor}`}>
          <span className="text-lg font-semibold tracking-tight">Repertoire Hero</span>
          {isBandMode && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 text-xs bg-purple-500/20 text-purple-300 px-2.5 py-1 rounded-full font-medium border border-purple-500/40">
                <span aria-hidden="true">🎸</span>
                Band Mode
              </span>
            </div>
          )}
        </div>

        <ContextSwitcher isBandMode={isBandMode} />

        <ul className="flex-1 flex flex-col gap-1 px-3 py-4" role="list">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(item.href) ? activeNavClass : inactiveNavClass
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className={`px-3 py-4 border-t ${borderColor}`}>
          <p className={`px-3 pb-3 text-xs ${isBandMode ? 'text-purple-500' : 'text-gray-500'}`}>
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${inactiveNavClass}`}
          >
            <span aria-hidden="true">🚪</span>
            Sign Out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 pb-16 md:pb-0">
        {/* Band mode banner */}
        {isBandMode && (
          <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 bg-purple-900 border-b border-purple-700 text-purple-100 text-sm shadow-sm">
            <span aria-hidden="true">🎸</span>
            <span className="font-semibold">Band Mode</span>
            <span className="text-purple-500" aria-hidden="true">·</span>
            <span className="text-purple-200 truncate">{bandName}</span>
            <span className="hidden sm:inline text-xs text-purple-400 ml-1">
              — Status is read-only, computed from all members
            </span>
            <button
              type="button"
              onClick={handleExitBandMode}
              className="ml-auto flex items-center gap-1 text-xs bg-purple-800 hover:bg-purple-700 border border-purple-600 px-2.5 py-1 rounded-md transition-colors shrink-0"
            >
              <span aria-hidden="true">✕</span>
              <span>Exit</span>
            </button>
          </div>
        )}
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main navigation"
        className={`md:hidden fixed bottom-0 inset-x-0 text-white border-t z-10 transition-colors duration-200 ${
          isBandMode ? 'bg-purple-950 border-purple-700' : 'bg-gray-900 border-gray-700'
        }`}
      >
        {isBandMode && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-purple-900/80 border-b border-purple-700/50 text-xs text-purple-300">
            <span className="flex items-center gap-1">
              <span aria-hidden="true">🎸</span>
              <span>Band Mode · {bandName}</span>
            </span>
            <button
              type="button"
              onClick={handleExitBandMode}
              className="text-purple-400 hover:text-white transition-colors"
            >
              ✕ Exit
            </button>
          </div>
        )}
        <ul className="flex" role="list">
          {NAV_ITEMS.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                  isActive(item.href)
                    ? isBandMode ? 'text-purple-300' : 'text-emerald-400'
                    : isBandMode ? 'text-purple-400 hover:text-white' : 'text-gray-400 hover:text-white'
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
              className={`flex w-full flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                isBandMode ? 'text-purple-400 hover:text-white' : 'text-gray-400 hover:text-white'
              }`}
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

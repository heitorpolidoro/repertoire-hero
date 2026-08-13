'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { authClient } from '@/lib/auth-client';
import { getBandsAction } from '@/app/actions/bands';
import { useBandContextStore } from '@/store/bandContextStore';
import { useRepertoireStore } from '@/store/repertoireStore';
import { getBandThemeStyles, DEFAULT_BAND_COLOR } from '@/lib/bandColors';

interface Band {
  id: string;
  name: string;
  role: 'admin' | 'member';
  color?: string | null;
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

function ContextSwitcherComponent({ isBandMode }: ContextSwitcherProps) {
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
    getBandsAction().then((b) => {
      const fetchedBands = b as unknown as Band[];
      setBands(fetchedBands);
      const currentCtx = useBandContextStore.getState().context;
      if (currentCtx.type === 'band') {
        const activeBand = fetchedBands.find((x) => x.id === currentCtx.id);
        if (activeBand) {
          const dbColor = activeBand.color ?? DEFAULT_BAND_COLOR;
          if (currentCtx.color !== dbColor || currentCtx.name !== activeBand.name) {
            useBandContextStore.getState().setBandContext(activeBand.id, activeBand.name, dbColor);
          }
        }
      }
    });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchContext = (next: { type: 'user' } | { type: 'band'; id: string; name: string; color?: string }) => {
    if (next.type === 'user') setUserContext();
    else setBandContext(next.id, next.name, next.color);
    setOpen(false);
    loadSongs();
    router.push('/');
  };

  if (!mounted || !user) return null;

  const label = context.type === 'band'
    ? context.name
    : (user.name ?? user.email?.split('@')[0] ?? 'Personal');

  return (
    <div className="px-3 py-3 border-b border-white/10" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 px-3 py-2 rounded-md transition-colors text-left ${
          isBandMode
            ? 'bg-white/15 hover:bg-white/25 ring-1 ring-white/20'
            : 'bg-gray-800 hover:bg-gray-700 text-white'
        }`}
      >
        <span className="text-base leading-none">
          {context.type === 'band' ? '🎸' : '👤'}
        </span>
        <span className="flex-1 text-sm font-medium truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''} opacity-80`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`mt-1 rounded-md border overflow-hidden shadow-lg ${isBandMode ? 'bg-black/40 backdrop-blur-md border-white/20' : 'bg-gray-800 border-gray-600'}`}>
          {/* Personal */}
          <button
            onClick={() => switchContext({ type: 'user' })}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              context.type === 'user'
                ? 'text-emerald-400 font-bold'
                : 'text-white/90 hover:bg-white/10'
            }`}
          >
            <span>👤</span>
            <span className="truncate">{user.name ?? user.email?.split('@')[0]}</span>
            {context.type === 'user' && <span className="ml-auto text-xs">✓</span>}
          </button>

          {bands.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs uppercase tracking-wider border-t border-white/10 opacity-60">
                Bands
              </div>
              {bands.map((band) => (
                <button
                  key={band.id}
                  onClick={() => switchContext({ type: 'band', id: band.id, name: band.name, color: band.color ?? undefined })}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    context.type === 'band' && context.id === band.id
                      ? 'font-bold bg-white/20 text-white'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/40" style={{ backgroundColor: band.color || DEFAULT_BAND_COLOR }} />
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

const ContextSwitcher = dynamic(() => Promise.resolve(ContextSwitcherComponent), {
  ssr: false,
});

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const context = useBandContextStore((s) => s.context);
  const { setUserContext } = useBandContextStore();
  const loadSongs = useRepertoireStore((s) => s.loadSongs);

  const { data: session } = authClient.useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Guard against hydration mismatch — persisted store might differ from SSR default
  const isBandMode = mounted && context.type === 'band';
  const bandName = context.type === 'band' ? context.name : '';
  const bandColor = context.type === 'band' ? context.color : null;
  const theme = getBandThemeStyles(isBandMode ? bandColor : null);

  if (mounted && !session?.user) {
    return <>{children}</>;
  }

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
    ? 'bg-white/20 font-bold'
    : 'bg-emerald-600 text-white font-bold';

  const inactiveNavClass = isBandMode
    ? 'opacity-80 hover:opacity-100 hover:bg-white/10'
    : 'text-gray-300 hover:bg-gray-700 hover:text-white';

  const sidebarBg = isBandMode ? '' : 'bg-gray-900';
  const borderColor = isBandMode ? 'border-white/15' : 'border-gray-700';

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <nav
        aria-label="Main navigation"
        className={`hidden md:flex flex-col w-60 ${sidebarBg} ${isBandMode ? '' : 'text-white'} shrink-0 transition-colors duration-200`}
        style={isBandMode ? theme.style : undefined}
      >
        {/* Header */}
        <div className={`px-6 py-5 border-b ${borderColor}`}>
          <span className="text-lg font-semibold tracking-tight">Repertoire Hero</span>
          {isBandMode && (
            <div className="mt-2">
              <span
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-bold border"
                style={theme.badgeStyle}
              >
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

        {process.env.NEXT_PUBLIC_APP_VERSION && (
          <p className="px-6 pb-2 text-xs opacity-60">
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </p>
        )}

        <div className={`px-3 py-4 border-t ${borderColor}`}>
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
          <div
            className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 border-b text-sm shadow-sm transition-colors"
            style={theme.style}
          >
            <span aria-hidden="true">🎸</span>
            <span className="font-bold">Band Mode</span>
            <span className="opacity-50" aria-hidden="true">·</span>
            <span className="font-semibold truncate">{bandName}</span>
            <span className="hidden sm:inline text-xs opacity-75 ml-1">
              — Status is read-only, computed from all members
            </span>
            <button
              type="button"
              onClick={handleExitBandMode}
              className="ml-auto flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 border border-white/30 px-2.5 py-1 rounded-md transition-colors shrink-0 font-semibold"
              style={{ color: theme.textColor }}
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
        className={`md:hidden fixed bottom-0 inset-x-0 border-t z-10 transition-colors duration-200 ${
          isBandMode ? '' : 'bg-gray-900 border-gray-700 text-white'
        }`}
        style={isBandMode ? theme.style : undefined}
      >
        {isBandMode && (
          <div
            className="flex items-center justify-between px-3 py-1.5 border-b text-xs font-semibold"
            style={{ borderColor: theme.borderStyle.borderColor }}
          >
            <span className="flex items-center gap-1">
              <span aria-hidden="true">🎸</span>
              <span>Band Mode · {bandName}</span>
            </span>
            <button
              type="button"
              onClick={handleExitBandMode}
              className="opacity-80 hover:opacity-100 transition-opacity"
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

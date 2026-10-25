'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { authClient } from '@/lib/auth-client';
import { useHydrated } from '@/hooks/useHydrated';
import { useContextSwitch, type ContextTarget } from '@/hooks/useContextSwitch';
import { useBandContextStore } from '@/store/bandContextStore';
import { SignOutButton } from '@/components/layout/SignOutButton';
import { BandModeIndicator } from '@/components/layout/BandModeIndicator';
import { MobileContextSwitcher } from '@/components/layout/MobileContextSwitcher';
import { getBandThemeStyles, DEFAULT_BAND_COLOR } from '@/lib/bandColors';
import { resolveBrowserLocale, type BandIndicatorCopy, type Locale } from '@/lib/i18n';
import type { BandOption } from '@/types/database';

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

const CATALOG_NAV_ITEM: NavItem = { label: 'Catalog', href: '/admin/catalog', icon: '📚' };

function navItemsFor(isSystemAdmin: boolean | undefined): NavItem[] {
  return isSystemAdmin ? [...NAV_ITEMS, CATALOG_NAV_ITEM] : NAV_ITEMS;
}

interface AppLayoutProps {
  children: React.ReactNode;
  bands: BandOption[];
  /** Adds the Catalog entry (RH-156). Cosmetic: /admin/catalog gates itself. */
  isSystemAdmin?: boolean;
  /** RH-180: every locale's band-indicator copy, built by the root layout. */
  bandIndicatorCopies: Record<Locale, BandIndicatorCopy>;
}

interface ContextSwitcherProps {
  isBandMode: boolean;
  bands: BandOption[];
}

interface SessionUser {
  name?: string | null;
  email?: string | null;
}

function displayName(user: SessionUser): string {
  return user.name ?? user.email?.split('@')[0] ?? 'Personal';
}

const FAST_VIEW_PATH = /^\/songs\/[^/]+\/fast-view(\/|$)/;

/**
 * RH-181: the name the mobile mode switch shows under Personal, or null when
 * there is no mobile switch: signed out, no band to switch to, or on Fast View,
 * which is addressed for one owner by its URL.
 */
function mobileSwitchUserName(user: SessionUser | null | undefined, bands: BandOption[], pathname: string): string | null {
  if (!user || bands.length === 0 || FAST_VIEW_PATH.test(pathname)) return null;
  return displayName(user);
}

/**
 * RH-181: the mobile switch sheet's open state, owned here because two
 * triggers open it: the personal bar inside `MobileContextSwitcher` and the
 * band name in `BandModeIndicator`. Only once hydrated, because the persisted
 * context store can disagree with the SSR default.
 */
function useMobileSwitch(
  session: { user?: SessionUser | null } | null | undefined,
  bands: BandOption[],
  pathname: string,
) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const userName = hydrated ? mobileSwitchUserName(session?.user, bands, pathname) : null;
  const onSwitch = userName === null ? undefined : () => setOpen(true);
  return { userName, open, setOpen, onSwitch };
}

const SIDEBAR_CLASSES = {
  band: {
    activeNav: 'bg-white/20 font-bold',
    inactiveNav: 'opacity-80 hover:opacity-100 hover:bg-white/10',
    sidebar: '',
    border: 'border-white/15',
  },
  personal: {
    activeNav: 'bg-emerald-600 text-white font-bold',
    inactiveNav: 'text-gray-300 hover:bg-gray-700 hover:text-white',
    sidebar: 'bg-gray-900 text-white',
    border: 'border-gray-700',
  },
};

function ContextSwitcherComponent({ isBandMode, bands }: ContextSwitcherProps) {
  const { data: session } = authClient.useSession();
  const user = session?.user ?? null;
  const context = useBandContextStore((s) => s.context);
  const { switchTo } = useContextSwitch();

  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchContext = (next: ContextTarget) => {
    setOpen(false);
    switchTo(next);
  };

  if (!hydrated || !user) return null;

  const label = context.type === 'band' ? context.name : displayName(user);

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
            <span className="truncate">{displayName(user)}</span>
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

/**
 * The app chrome — one stable element tree across every session phase (RH-73).
 *
 * `children` are rendered from the single return below, always inside the same
 * content wrapper at the same tree position, so React never unmounts the route
 * subtree. Only the chrome elements and the wrappers' classes and role vary.
 *
 * Chrome visibility follows the session alone, never hydration: it is shown
 * while `useSession()` is still pending — which keeps the server HTML and the
 * first client render exactly what they were — and hidden only once the session
 * has resolved to no user, in which case both wrappers go layout-neutral
 * (`contents`) and the `main` landmark is withheld, so a chrome-less page such
 * as the signed-out landing page lays itself out and owns its own landmarks.
 *
 * The hydration flag survives only for the band-mode guard below: the
 * persisted context store can disagree with the SSR default. It comes from
 * `useHydrated()` (`useSyncExternalStore`) rather than the `useState(false)` +
 * `useEffect(() => setMounted(true), [])` pair it replaced, which was a
 * `react-hooks/set-state-in-effect` error (RH-129).
 */
export default function AppLayout({ children, bands, isSystemAdmin, bandIndicatorCopies }: AppLayoutProps) {
  const navItems = navItemsFor(isSystemAdmin);
  const pathname = usePathname();
  const context = useBandContextStore((s) => s.context);
  const { switchTo } = useContextSwitch();

  const { data: session, isPending } = authClient.useSession();
  const hydrated = useHydrated();
  const mobileSwitch = useMobileSwitch(session, bands, pathname);

  const showChrome = isPending || !!session?.user;
  const chrome = showChrome
    ? { outer: 'flex h-screen', content: 'flex-1 overflow-y-auto bg-gray-50 pb-16 md:pb-0', role: 'main' as const }
    : { outer: 'contents', content: 'contents', role: undefined };

  const band = context.type === 'band' ? context : null;
  const isBandMode = hydrated && showChrome && band !== null;
  const theme = getBandThemeStyles(isBandMode ? band.color : null);
  const chromeStyle = isBandMode ? theme.style : undefined;

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleExitBandMode = () => switchTo({ type: 'user' });

  const {
    activeNav: activeNavClass,
    inactiveNav: inactiveNavClass,
    sidebar: sidebarTheme,
    border: borderColor,
  } = SIDEBAR_CLASSES[isBandMode ? 'band' : 'personal'];

  return (
    <div className={chrome.outer}>
      {/* Desktop sidebar — chrome only */}
      {showChrome && (
        <nav
          aria-label="Main navigation"
          className={`hidden md:flex flex-col w-60 ${sidebarTheme} shrink-0 transition-colors duration-200`}
          style={chromeStyle}
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

          <ContextSwitcher isBandMode={isBandMode} bands={bands} />

          <ul className="flex-1 flex flex-col gap-1 px-3 py-4" role="list">
            {navItems.map((item) => (
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
            <p className="px-6 pb-2 text-xs opacity-60">v{process.env.NEXT_PUBLIC_APP_VERSION}</p>
          )}

          <div className={`px-3 py-4 border-t ${borderColor}`}>
            <SignOutButton
              className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${inactiveNavClass}`}
            />
          </div>
        </nav>
      )}

      {/* Content wrapper — the same element in every session phase */}
      <div className={chrome.content} role={chrome.role}>
        {isBandMode && (
          <BandModeIndicator
            band={band}
            theme={theme}
            // Only rendered once hydrated, so reading the browser locale here
            // can never disagree with the server HTML.
            copy={bandIndicatorCopies[resolveBrowserLocale(document.cookie, navigator.languages)]}
            onExit={handleExitBandMode}
            onSwitch={mobileSwitch.onSwitch}
          />
        )}
        {mobileSwitch.userName !== null && (
          <MobileContextSwitcher
            bands={bands}
            context={context}
            userName={mobileSwitch.userName}
            open={mobileSwitch.open}
            onOpenChange={mobileSwitch.setOpen}
          />
        )}
        {children}
      </div>

      {/* Mobile bottom navigation — chrome only */}
      {showChrome && (
        <nav
          aria-label="Main navigation"
          className={`md:hidden fixed bottom-0 inset-x-0 border-t z-10 transition-colors duration-200 ${
            isBandMode ? '' : 'bg-gray-900 border-gray-700 text-white'
          }`}
          style={chromeStyle}
        >
          <ul className="flex" role="list">
            {navItems.map((item) => (
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
              <SignOutButton
                className={`flex w-full flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                  isBandMode ? 'text-purple-400 hover:text-white' : 'text-gray-400 hover:text-white'
                }`}
                iconClassName="text-xl leading-none"
              />
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useContextSwitch, type ContextTarget } from '@/hooks/useContextSwitch';
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors';
import type { BandContext } from '@/store/bandContextStore';
import type { BandOption } from '@/types/database';

interface MobileContextSwitcherProps {
  bands: BandOption[];
  context: BandContext;
  /** Shown under the Personal option. */
  userName: string;
  /** The sheet's open state is owned by AppLayout, because the band bar opens it too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SheetOption {
  key: string;
  target: ContextTarget;
  title: string;
  subtitle?: string;
  /** A band's colour dot; the Personal option shows a person icon instead. */
  dot?: string;
}

function isActiveTarget(context: BandContext, target: ContextTarget): boolean {
  if (target.type === 'user') return context.type === 'user';
  return context.type === 'band' && context.id === target.id;
}

/**
 * RH-181 — the mobile mode switch, below the md breakpoint only.
 *
 * In personal context it renders a slim bar in normal flow at the top of the
 * content (it scrolls away with the page) carrying the Switch mode trigger; in
 * band context the RH-180 band bar carries the trigger instead, so no bar is
 * rendered here. Either trigger opens the same bottom sheet, which lists
 * Personal and every band and switches through `useContextSwitch`, the routine
 * the desktop sidebar switcher uses. With zero bands there is nothing to switch
 * to and nothing is rendered.
 */
export function MobileContextSwitcher({ bands, context, userName, open, onOpenChange }: MobileContextSwitcherProps) {
  const { switchTo } = useContextSwitch();

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onOpenChange]);

  if (bands.length === 0) return null;

  const choose = (target: ContextTarget) => {
    if (!isActiveTarget(context, target)) switchTo(target);
    onOpenChange(false);
  };

  const personal: SheetOption = { key: 'user', target: { type: 'user' }, title: 'Personal', subtitle: userName };
  const bandOptions: SheetOption[] = bands.map((band) => ({
    key: band.id,
    target: { type: 'band', id: band.id, name: band.name, color: band.color ?? undefined },
    title: band.name,
    dot: band.color || DEFAULT_BAND_COLOR,
  }));

  const renderOption = (option: SheetOption) => {
    const active = isActiveTarget(context, option.target);
    return (
      <button
        key={option.key}
        type="button"
        onClick={() => choose(option.target)}
        aria-current={active ? 'true' : undefined}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          active ? 'bg-emerald-50' : 'hover:bg-gray-50'
        }`}
      >
        {option.dot ? (
          <span
            aria-hidden="true"
            className="w-3 h-3 rounded-full shrink-0 border border-black/10"
            style={{ backgroundColor: option.dot }}
          />
        ) : (
          <span aria-hidden="true" className="text-lg leading-none">👤</span>
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-gray-900 truncate">{option.title}</span>
          {option.subtitle && <span className="block text-xs text-gray-500 truncate">{option.subtitle}</span>}
        </span>
        {active && <span aria-hidden="true" className="text-emerald-600 font-bold">✓</span>}
      </button>
    );
  };

  return (
    <div className="md:hidden">
      {context.type === 'user' && (
        <div
          data-testid="mobile-context-bar"
          className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 text-sm"
        >
          <span aria-hidden="true">👤</span>
          <span className="font-semibold text-gray-800">Personal</span>
          <button
            type="button"
            data-testid="mobile-context-trigger"
            aria-haspopup="dialog"
            aria-label="Switch mode"
            onClick={() => onOpenChange(true)}
            className="ml-auto flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            Switch <span aria-hidden="true">▾</span>
          </button>
        </div>
      )}

      {open && (
        <>
          <div
            data-testid="mobile-context-backdrop"
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-black/40"
            onClick={() => onOpenChange(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Switch mode"
            data-testid="mobile-context-sheet"
            className="fixed inset-x-0 bottom-14 z-30 max-h-[70vh] overflow-y-auto bg-white rounded-t-2xl shadow-2xl pb-3"
          >
            <div className="flex items-center px-4 pt-3 pb-2">
              <span className="text-sm font-bold text-gray-900">Switch mode</span>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="ml-auto text-xs text-gray-500 px-2 py-1"
              >
                Close
              </button>
            </div>
            {renderOption(personal)}
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-gray-400 border-t border-gray-100">
              Bands
            </div>
            {bandOptions.map(renderOption)}
          </div>
        </>
      )}
    </div>
  );
}

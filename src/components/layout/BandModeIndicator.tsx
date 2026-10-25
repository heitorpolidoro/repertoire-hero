'use client';

import type { getBandThemeStyles } from '@/lib/bandColors';
import type { BandIndicatorCopy } from '@/lib/i18n';

interface BandModeIndicatorProps {
  band: { name: string };
  theme: ReturnType<typeof getBandThemeStyles>;
  copy: BandIndicatorCopy;
  onExit: () => void;
  /**
   * RH-181: when given, the band name opens the mobile mode sheet below the md
   * breakpoint. At md+ it stays plain text, where the sidebar switcher exists.
   * Omitted on Fast View, where the bar keeps only Exit.
   */
  onSwitch?: () => void;
}

const NAME_CLASS = 'font-semibold truncate min-w-0';

/**
 * RH-180 — the one persistent band-mode cue, at every width.
 *
 * Sticky at the top of the content wrapper, in the band's colour, with a band
 * icon, the localized label, the band name (truncated, never wrapped) and Exit.
 * `AppLayout` renders it only in band context, so in personal context no
 * `band-indicator` element exists at all.
 */
export function BandModeIndicator({ band, theme, copy, onExit, onSwitch }: BandModeIndicatorProps) {
  return (
    <div
      data-testid="band-indicator"
      className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2.5 border-b text-sm shadow-sm transition-colors"
      style={{ ...theme.style, ...theme.borderStyle }}
    >
      <span data-testid="band-indicator-icon" aria-hidden="true">🎸</span>
      <span className="font-bold shrink-0">{copy.label}</span>
      <span className="opacity-50" aria-hidden="true">·</span>
      {onSwitch ? (
        <>
          <button
            type="button"
            data-testid="mobile-context-trigger"
            aria-haspopup="dialog"
            aria-label="Switch mode"
            onClick={onSwitch}
            className="md:hidden flex items-center gap-1 min-w-0 text-left underline decoration-dotted underline-offset-4"
          >
            <span className={NAME_CLASS}>{band.name}</span>
            <span aria-hidden="true" className="shrink-0">▾</span>
          </button>
          <span className={`hidden md:inline ${NAME_CLASS}`}>{band.name}</span>
        </>
      ) : (
        <span className={NAME_CLASS}>{band.name}</span>
      )}
      <button
        type="button"
        data-testid="band-indicator-exit"
        onClick={onExit}
        className="ml-auto flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 border border-white/30 px-2.5 py-1 rounded-md transition-colors shrink-0 font-semibold"
        style={{ color: theme.textColor }}
      >
        <span aria-hidden="true">✕</span>
        <span>{copy.exit}</span>
      </button>
    </div>
  );
}

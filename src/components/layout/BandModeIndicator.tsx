'use client';

import type { getBandThemeStyles } from '@/lib/bandColors';
import type { BandIndicatorCopy } from '@/lib/i18n';

interface BandModeIndicatorProps {
  band: { name: string };
  theme: ReturnType<typeof getBandThemeStyles>;
  copy: BandIndicatorCopy;
  onExit: () => void;
}

/**
 * RH-180 — the one persistent band-mode cue, at every width.
 *
 * Sticky at the top of the content wrapper, in the band's colour, with a band
 * icon, the localized label, the band name (truncated, never wrapped) and Exit.
 * `AppLayout` renders it only in band context, so in personal context no
 * `band-indicator` element exists at all.
 */
export function BandModeIndicator({ band, theme, copy, onExit }: BandModeIndicatorProps) {
  return (
    <div
      data-testid="band-indicator"
      className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2.5 border-b text-sm shadow-sm transition-colors"
      style={{ ...theme.style, ...theme.borderStyle }}
    >
      <span data-testid="band-indicator-icon" aria-hidden="true">🎸</span>
      <span className="font-bold shrink-0">{copy.label}</span>
      <span className="opacity-50" aria-hidden="true">·</span>
      <span className="font-semibold truncate min-w-0">{band.name}</span>
      <button
        type="button"
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

'use client'

export const INSTRUMENT_LIST = [
  'Vocals', 'Backing Vocals', 'Guitar', 'Electric Guitar', 'Bass Guitar',
  'Piano', 'Keyboard', 'Drums', 'Percussion',
  'Violin', 'Viola', 'Cello', 'Double Bass',
  'Trumpet', 'Trombone', 'French Horn', 'Tuba',
  'Saxophone', 'Clarinet', 'Flute',
  'Ukulele', 'Banjo', 'Mandolin', 'Harmonica', 'Harp', 'Accordion',
]

export const INSTRUMENT_ICONS: Record<string, string> = {
  'Vocals':         '🎤',
  'Backing Vocals': '🎤',
  'Guitar':         '🎸',
  'Electric Guitar':'🎸',
  'Bass Guitar':    '🎸',
  'Piano':          '🎹',
  'Keyboard':       '🎹',
  'Drums':          '🥁',
  'Percussion':     '🥁',
  'Violin':         '🎻',
  'Viola':          '🎻',
  'Cello':          '🎻',
  'Double Bass':    '🎻',
  'Trumpet':        '🎺',
  'Trombone':       '🎺',
  'French Horn':    '📯',
  'Tuba':           '🎺',
  'Saxophone':      '🎷',
  'Clarinet':       '🎵',
  'Flute':          '🎵',
  'Ukulele':        '🪕',
  'Banjo':          '🪕',
  'Mandolin':       '🪕',
  'Harmonica':      '🎵',
  'Harp':           '🎵',
  'Accordion':      '🪗',
}

interface InstrumentPickerProps {
  selected: string[]
  primary: string | null
  onChange: (selected: string[], primary: string | null) => void
}

export function InstrumentPicker({ selected, primary, onChange }: InstrumentPickerProps) {
  const toggle = (instrument: string) => {
    if (selected.includes(instrument)) {
      const next = selected.filter((i) => i !== instrument)
      onChange(next, primary === instrument ? (next[0] ?? null) : primary)
    } else {
      const next = [...selected, instrument]
      onChange(next, primary ?? instrument)
    }
  }

  const setPrimary = (e: React.MouseEvent, instrument: string) => {
    e.stopPropagation()
    if (selected.includes(instrument)) onChange(selected, instrument)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {INSTRUMENT_LIST.map((instrument) => {
        const isSelected = selected.includes(instrument)
        const isPrimary = primary === instrument
        return (
          <button
            key={instrument}
            type="button"
            onClick={() => toggle(instrument)}
            aria-pressed={isSelected}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              isSelected
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300 hover:text-emerald-600'
            }`}
          >
            <span aria-hidden="true">{INSTRUMENT_ICONS[instrument] ?? '🎵'}</span>
            {instrument}
            {isSelected && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => setPrimary(e, instrument)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    if (selected.includes(instrument)) onChange(selected, instrument)
                  }
                }}
                aria-label={isPrimary ? 'Primary instrument' : `Set ${instrument} as primary`}
                title={isPrimary ? 'Primary' : 'Set as primary'}
                className="ml-0.5 focus:outline-none"
              >
                {isPrimary ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-yellow-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-300 hover:text-yellow-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                )}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

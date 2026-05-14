import type { SongStatus } from '@/types/database'

export const STATUS_CONFIG: Record<
  SongStatus,
  { label: string; color: string; bgColor: string; textColor: string }
> = {
  unknown:    { label: 'Unknown',    color: 'gray',   bgColor: 'bg-gray-100',   textColor: 'text-gray-600' },
  learning:   { label: 'Learning',   color: 'blue',   bgColor: 'bg-blue-100',   textColor: 'text-blue-700' },
  practicing: { label: 'Practicing', color: 'yellow', bgColor: 'bg-yellow-100', textColor: 'text-yellow-700' },
  polishing:  { label: 'Polishing',  color: 'orange', bgColor: 'bg-orange-100', textColor: 'text-orange-700' },
  mastered:   { label: 'Mastered',   color: 'green',  bgColor: 'bg-green-100',  textColor: 'text-green-700' },
}

export const STATUS_ORDER: SongStatus[] = [
  'unknown',
  'learning',
  'practicing',
  'polishing',
  'mastered',
]

export function nextStatus(current: SongStatus): SongStatus {
  const idx = STATUS_ORDER.indexOf(current)
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
}

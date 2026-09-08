// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSongEntry, type SongEntryActions, type UseSongEntryOptions } from '@/hooks/useSongEntry'
import { logger } from '@/lib/logger'
import type { GlobalSong, Repertoire } from '@/types/database'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

afterEach(cleanup)

const SONG: GlobalSong = {
  id: 'song-1',
  title: 'Black Dog',
  artist: 'Led Zeppelin',
  album: 'IV',
  standard_key: 'A',
  cover_url: null,
  duration_seconds: null,
  links: [{ label: 'Chords', url: 'https://cifraclub.com.br/black-dog' }],
  created_at: '2026-01-01T00:00:00.000Z',
}

const BAND_ENTRY: Repertoire = {
  id: 'rep-band',
  user_id: null,
  band_id: 'band-1',
  song_id: 'song-1',
  personal_key: null,
  status: 'learning',
  tags: ['rock'],
  last_practiced: null,
  lyrics: 'band words',
  song: SONG,
}

const PERSONAL_ENTRY: Repertoire = {
  ...BAND_ENTRY,
  id: 'rep-personal',
  user_id: 'user-1',
  band_id: null,
  lyrics: 'my words',
}

type ActionSpies = { [K in keyof SongEntryActions]: Mock }

function makeActions(): ActionSpies {
  return {
    getSongEntry: vi.fn().mockResolvedValue(BAND_ENTRY),
    getPersonalEntryForSong: vi.fn().mockResolvedValue(PERSONAL_ENTRY),
  }
}

function setup(overrides: Partial<UseSongEntryOptions> = {}) {
  const actions = (overrides.actions as ActionSpies | undefined) ?? makeActions()
  const initialProps: UseSongEntryOptions = {
    repertoireId: 'rep-band',
    bandId: 'band-1',
    ...overrides,
    actions,
  }
  const view = renderHook((props: UseSongEntryOptions) => useSongEntry(props), { initialProps })
  return { ...view, actions, initialProps }
}

/** Drain the pending action promises inside `act`. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useSongEntry', () => {
  it('loads the entry for the route id and clears the loading flag', async () => {
    const { result, actions } = setup()
    expect(result.current.loading).toBe(true)

    await flush()

    expect(actions.getSongEntry).toHaveBeenCalledWith('rep-band', 'band-1')
    expect(result.current.entry).toEqual(BAND_ENTRY)
    expect(result.current.loading).toBe(false)
    expect(result.current.notFound).toBe(false)
    expect(result.current.identity).toEqual({ title: 'Black Dog', artist: 'Led Zeppelin', key: 'A' })
  })

  it('reports not found when the entry does not exist', async () => {
    const actions = makeActions()
    actions.getSongEntry.mockResolvedValue(null)
    const { result } = setup({ actions })

    await flush()

    expect(result.current.notFound).toBe(true)
    expect(result.current.entry).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(actions.getPersonalEntryForSong).not.toHaveBeenCalled()
  })

  it('reports not found when the entry load throws', async () => {
    const actions = makeActions()
    actions.getSongEntry.mockRejectedValue(new Error('Access denied'))
    const { result } = setup({ actions })

    await flush()

    expect(result.current).toMatchObject({ notFound: true, entry: null, loading: false })
  })

  it('loads the personal entry in band context and exposes it', async () => {
    const { result, actions } = setup()

    await flush()

    expect(actions.getPersonalEntryForSong).toHaveBeenCalledTimes(1)
    expect(actions.getPersonalEntryForSong).toHaveBeenCalledWith('song-1')
    expect(result.current.personalEntry).toEqual(PERSONAL_ENTRY)
    expect(result.current.loadingPersonal).toBe(false)
  })

  it('does not load a personal entry outside a band context', async () => {
    const actions = makeActions()
    actions.getSongEntry.mockResolvedValue(PERSONAL_ENTRY)
    const { result, actions: spies } = setup({ actions, bandId: null })

    await flush()

    expect(spies.getPersonalEntryForSong).not.toHaveBeenCalled()
    expect(result.current.personalEntry).toBeNull()
    expect(result.current.loadingPersonal).toBe(false)
  })

  it('keeps the entry and clears loadingPersonal when the personal load fails', async () => {
    const actions = makeActions()
    actions.getPersonalEntryForSong.mockRejectedValue(new Error('nope'))
    const { result } = setup({ actions })

    await flush()

    expect(logger.error).toHaveBeenCalledWith('Failed to load personal entry', expect.any(Error))
    expect(result.current.entry).toEqual(BAND_ENTRY)
    expect(result.current.personalEntry).toBeNull()
    expect(result.current.loadingPersonal).toBe(false)
  })

  it('refetches the entry when the band id from the query changes', async () => {
    const { rerender, actions, initialProps } = setup()
    await flush()
    expect(actions.getSongEntry).toHaveBeenCalledTimes(1)

    // Only `?bandId=` changes: the route id is the same. The load effect must
    // still refetch, i.e. its dependency array carries the band id (F26).
    rerender({ ...initialProps, bandId: 'band-2' })
    await flush()

    expect(actions.getSongEntry).toHaveBeenCalledTimes(2)
    expect(actions.getSongEntry).toHaveBeenLastCalledWith('rep-band', 'band-2')
  })

  it('exposes the tab library inputs taken from the two entries', async () => {
    const { result } = setup()

    await flush()

    expect(result.current.entryBandId).toBe('band-1')
    expect(result.current.songId).toBe('song-1')
    expect(result.current.personalRepertoireId).toBe('rep-personal')
  })

  it('applyStatus patches the entry status', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.applyStatus('mastered'))

    expect(result.current.entry?.status).toBe('mastered')
  })

  it('applyLinks patches the song links', async () => {
    const { result } = setup()
    await flush()
    const links = [{ label: 'Video', url: 'https://youtube.com/watch?v=1' }]

    act(() => result.current.applyLinks(links))

    expect(result.current.entry?.song?.links).toEqual(links)
  })

  it('applyEntryLyrics and applyPersonalLyrics patch the two lyrics texts', async () => {
    const { result } = setup()
    await flush()

    act(() => result.current.applyEntryLyrics('new band words'))
    act(() => result.current.applyPersonalLyrics('new personal words'))

    expect(result.current.entry?.lyrics).toBe('new band words')
    expect(result.current.personalEntry?.lyrics).toBe('new personal words')
  })

  it('adoptPersonalEntry adopts an entry created by another controller', async () => {
    const actions = makeActions()
    actions.getPersonalEntryForSong.mockResolvedValue(null)
    const { result } = setup({ actions })
    await flush()
    expect(result.current.personalEntry).toBeNull()

    const created: Repertoire = { ...PERSONAL_ENTRY, id: 'rep-created' }
    act(() => result.current.adoptPersonalEntry(created))

    expect(result.current.personalEntry).toEqual(created)
    expect(result.current.personalRepertoireId).toBe('rep-created')
  })
})

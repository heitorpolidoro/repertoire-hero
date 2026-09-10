// @vitest-environment jsdom
/**
 * RH-70 — the Spotify sync controller of `/playlists/[id]`.
 *
 * Three properties of the page's old inline pair only exist while something is
 * in flight, so this is the only place they can be observed:
 *
 * - the `syncing` window, which is what disables the Sync button and swaps its
 *   icon for a spinner, and which a push must never enter;
 * - the settle-versus-reject asymmetry — `pull` reports through `onError` and
 *   resolves, `pushIfNeeded` rejects and reports nothing, which is what lets
 *   `useSongPicker` record a failed auto-push against the row it was adding;
 * - the auto-push gate, which must issue no request at all rather than post and
 *   let the server decide.
 *
 * `global.fetch` is stubbed and the options are `vi.fn()`s the page would
 * otherwise bind, so nothing here imports a Server Action.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSpotifySync, type SpotifySyncOptions } from '@/hooks/useSpotifySync'
import type { Playlist } from '@/types/database'

afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

type SyncablePlaylist = Pick<Playlist, 'sync_with_spotify' | 'spotify_playlist_id'>

function playlist(overrides: Partial<SyncablePlaylist> = {}): SyncablePlaylist {
  return {
    sync_with_spotify: true,
    spotify_playlist_id: 'spotify-playlist-1',
    ...overrides,
  }
}

/** A response the route handler could plausibly return. */
function response(init: { ok: boolean; body?: unknown; broken?: boolean }): Response {
  return {
    ok: init.ok,
    json: init.broken
      ? () => Promise.reject(new Error('Unexpected token < in JSON'))
      : () => Promise.resolve(init.body ?? {}),
  } as unknown as Response
}

function setup(overrides: Partial<SpotifySyncOptions> = {}) {
  const onError: Mock = vi.fn()
  const onSynced: Mock = vi.fn().mockResolvedValue(undefined)
  const options: SpotifySyncOptions = {
    playlistId: 'playlist-1',
    playlist: playlist(),
    onError,
    onSynced,
    ...overrides,
  }
  const view = renderHook(() => useSpotifySync(options))
  return { ...view, onError, onSynced }
}

/** Stubs `fetch` with a single canned response and hands back the spy. */
function stubFetch(init: { ok: boolean; body?: unknown; broken?: boolean }): Mock {
  const spy: Mock = vi.fn().mockResolvedValue(response(init))
  vi.stubGlobal('fetch', spy)
  return spy
}

/**
 * Stubs `fetch` with a request that stays in flight until `release` is called —
 * the only way to observe the state of the controller mid-round-trip.
 */
function deferFetch(): { release: () => void } {
  let resolveWith: (value: Response) => void = () => {}
  const spy: Mock = vi.fn(
    () =>
      new Promise<Response>(resolve => {
        resolveWith = resolve
      }),
  )
  vi.stubGlobal('fetch', spy)
  return { release: () => resolveWith(response({ ok: true })) }
}

describe('useSpotifySync', () => {
  it('starts idle and issues no request', () => {
    const spy = stubFetch({ ok: true })
    const { result } = setup()

    expect(result.current.syncing).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('posts a pull to the sync endpoint and reloads the playlist', async () => {
    const spy = stubFetch({ ok: true })
    const { result, onSynced } = setup()

    await act(async () => {
      await result.current.pull()
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('/api/spotify/playlists/playlist-1/sync')
    expect(spy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'pull' }),
    })
    expect(onSynced).toHaveBeenCalledTimes(1)
  })

  it('clears the error banner when a pull starts', async () => {
    stubFetch({ ok: true })
    const { result, onError } = setup()

    await act(async () => {
      await result.current.pull()
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(null)
  })

  it('reports syncing while the pull is in flight and idle again once it settles', async () => {
    const { release } = deferFetch()
    const { result } = setup()

    let pulled: Promise<void> = Promise.resolve()
    await act(async () => {
      pulled = result.current.pull()
    })
    expect(result.current.syncing).toBe(true)

    await act(async () => {
      release()
      await pulled
    })
    expect(result.current.syncing).toBe(false)
  })

  it('reports the server error message when a pull fails', async () => {
    stubFetch({ ok: false, body: { error: 'Spotify token expired' } })
    const { result, onError } = setup()

    await act(async () => {
      await result.current.pull()
    })

    expect(onError).toHaveBeenLastCalledWith('Spotify token expired')
  })

  it('falls back to Sync failed when the failed response carries no message', async () => {
    stubFetch({ ok: false, body: { code: 500 } })
    const { result, onError } = setup()

    await act(async () => {
      await result.current.pull()
    })

    expect(onError).toHaveBeenLastCalledWith('Sync failed')
  })

  it('falls back to Sync failed when the response body is not JSON', async () => {
    stubFetch({ ok: false, broken: true })
    const { result, onError } = setup()

    await act(async () => {
      await result.current.pull()
    })

    expect(onError).toHaveBeenLastCalledWith('Sync failed')
  })

  it('does not reload the playlist after a failed pull, and still stops syncing', async () => {
    stubFetch({ ok: false, body: { error: 'Spotify token expired' } })
    const { result, onSynced } = setup()

    await act(async () => {
      await result.current.pull()
    })

    expect(onSynced).not.toHaveBeenCalled()
    expect(result.current.syncing).toBe(false)
  })

  it('posts a push for a playlist that auto-syncs', async () => {
    const spy = stubFetch({ ok: true })
    const { result, onSynced } = setup()

    await act(async () => {
      await result.current.pushIfNeeded()
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('/api/spotify/playlists/playlist-1/sync')
    expect(spy.mock.calls[0][1]).toMatchObject({
      body: JSON.stringify({ direction: 'push' }),
    })
    expect(onSynced).not.toHaveBeenCalled()
  })

  it('issues no request and resolves when the playlist does not auto-sync', async () => {
    const spy = stubFetch({ ok: true })
    const off = setup({ playlist: playlist({ sync_with_spotify: false }) })
    const unlinked = setup({ playlist: playlist({ spotify_playlist_id: null }) })
    const missing = setup({ playlist: null })

    await act(async () => {
      await off.result.current.pushIfNeeded()
      await unlinked.result.current.pushIfNeeded()
      await missing.result.current.pushIfNeeded()
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects with the server message when a push fails, so the caller can report it', async () => {
    stubFetch({ ok: false, body: { error: 'Spotify rejected the order' } })
    const { result, onError } = setup()

    await act(async () => {
      await expect(result.current.pushIfNeeded()).rejects.toThrow('Spotify rejected the order')
    })

    expect(onError).not.toHaveBeenCalled()
  })

  it('never enters the syncing state for a push', async () => {
    const { release } = deferFetch()
    const { result } = setup()

    let pushed: Promise<void> = Promise.resolve()
    await act(async () => {
      pushed = result.current.pushIfNeeded()
    })
    expect(result.current.syncing).toBe(false)

    await act(async () => {
      release()
      await pushed
    })
    expect(result.current.syncing).toBe(false)
  })
})

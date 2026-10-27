// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import {
  useApiTokenSettings,
  type ApiTokenSettingsActions,
} from '../useApiTokenSettings'
import type { ApiTokenRecord } from '@/lib/apiTokens'

describe('useApiTokenSettings', () => {
  afterEach(cleanup)

  const mockTokens: ApiTokenRecord[] = [
    {
      id: 't1',
      userId: 'u1',
      name: 'Claude Code',
      tokenPrefix: 'rh_pat_Q3vK',
      scopes: ['read', 'write:songs', 'write:tabs'],
      createdAt: '2026-10-27T12:00:00.000Z',
      lastUsedAt: null,
      expiresAt: '2027-01-25T12:00:00.000Z',
      revokedAt: null,
    },
  ]

  let actions: ApiTokenSettingsActions

  beforeEach(() => {
    actions = {
      listTokens: vi.fn().mockResolvedValue({ tokens: mockTokens }),
      createToken: vi.fn(),
      revokeToken: vi.fn(),
    }
  })

  it('loads tokens on mount', async () => {
    const { result } = renderHook(() => useApiTokenSettings({ actions }))

    expect(result.current.tokens).toBeNull()

    // Wait for load
    await act(async () => {})

    expect(result.current.tokens).toEqual(mockTokens)
    expect(actions.listTokens).toHaveBeenCalledTimes(1)
  })

  it('handles creation flow and one-time reveal', async () => {
    const newTokenRecord: ApiTokenRecord = {
      id: 't2',
      userId: 'u1',
      name: 'Codex',
      tokenPrefix: 'rh_pat_m8Lw',
      scopes: ['read'],
      createdAt: '2026-10-27T13:00:00.000Z',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    }

    vi.mocked(actions.createToken).mockResolvedValue({
      token: newTokenRecord,
      plaintext: 'rh_pat_m8Lw1234567890abcdefghijklmnopqrstuvwxyz1234',
    })
    vi.mocked(actions.listTokens).mockResolvedValue({
      tokens: [newTokenRecord, ...mockTokens],
    })

    const { result } = renderHook(() => useApiTokenSettings({ actions }))
    await act(async () => {})

    act(() => {
      result.current.startCreate()
    })
    expect(result.current.isCreating).toBe(true)

    act(() => {
      result.current.setNameDraft('Codex')
      result.current.setExpiryDraft(null)
    })

    await act(async () => {
      await result.current.submitCreate()
    })

    expect(actions.createToken).toHaveBeenCalledWith({
      name: 'Codex',
      scopes: ['read'],
      expiryDays: null,
    })

    expect(result.current.isCreating).toBe(false)
    expect(result.current.reveal).toEqual({
      tokenName: 'Codex',
      plaintext: 'rh_pat_m8Lw1234567890abcdefghijklmnopqrstuvwxyz1234',
    })

    // After dismissReveal (Done clicked), reveal is cleared
    act(() => {
      result.current.dismissReveal()
    })
    expect(result.current.reveal).toBeNull()
  })

  it('shows validation error inline under form when creation fails', async () => {
    vi.mocked(actions.createToken).mockResolvedValue({
      error: 'Give the token a name.',
    })

    const { result } = renderHook(() => useApiTokenSettings({ actions }))
    await act(async () => {})

    act(() => {
      result.current.startCreate()
      result.current.setNameDraft('')
    })

    await act(async () => {
      await result.current.submitCreate()
    })

    expect(result.current.error).toBe('Give the token a name.')
    expect(result.current.isCreating).toBe(true)
    expect(result.current.reveal).toBeNull()
  })

  it('handles revoke confirmation and removal', async () => {
    vi.mocked(actions.revokeToken).mockResolvedValue({ success: true })
    vi.mocked(actions.listTokens).mockResolvedValue({ tokens: [] })

    const { result } = renderHook(() => useApiTokenSettings({ actions }))
    await act(async () => {})

    act(() => {
      result.current.requestRevoke('t1')
    })
    expect(result.current.pendingRevokeId).toBe('t1')

    // Cancel revoke
    act(() => {
      result.current.cancelRevoke()
    })
    expect(result.current.pendingRevokeId).toBeNull()

    // Confirm revoke
    act(() => {
      result.current.requestRevoke('t1')
    })

    await act(async () => {
      await result.current.confirmRevoke()
    })

    expect(actions.revokeToken).toHaveBeenCalledWith('t1')
    expect(result.current.pendingRevokeId).toBeNull()
    expect(result.current.tokens).toEqual([])
  })
})

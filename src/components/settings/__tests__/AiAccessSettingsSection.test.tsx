// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AiAccessSettingsSection } from '../AiAccessSettingsSection'
import type { ApiTokenSettingsActions } from '@/hooks/useApiTokenSettings'
import type { ApiTokenRecord } from '@/lib/apiTokens'

describe('AiAccessSettingsSection', () => {
  afterEach(cleanup)

  let tokensStore: ApiTokenRecord[]
  let actions: ApiTokenSettingsActions

  beforeEach(() => {
    tokensStore = []

    actions = {
      listTokens: vi.fn(async () => ({ tokens: [...tokensStore] })),
      createToken: vi.fn(async ({ name, scopes }) => {
        if (!name.trim()) return { error: 'Give the token a name.' }
        const token: ApiTokenRecord = {
          id: 'token-created-1',
          userId: 'u1',
          name: name.trim(),
          tokenPrefix: 'rh_pat_AbC1',
          scopes,
          createdAt: '2026-10-27T12:00:00.000Z',
          lastUsedAt: null,
          expiresAt: '2027-01-25T12:00:00.000Z',
          revokedAt: null,
        }
        tokensStore.unshift(token)
        return {
          token,
          plaintext: 'rh_pat_AbC1234567890abcdefghijklmnopqrstuvwxyz1234',
        }
      }),
      revokeToken: vi.fn(async (tokenId) => {
        tokensStore = tokensStore.filter((t) => t.id !== tokenId)
        return { success: true }
      }),
    }
  })

  it('renders empty state when there are no tokens', async () => {
    render(<AiAccessSettingsSection actions={actions} offline={false} />)

    await waitFor(() => {
      expect(
        screen.getByText('No tokens yet. Create one to let an AI agent work on your songs.'),
      ).toBeDefined()
    })
  })

  it('shows create form and displays validation error inline', async () => {
    render(<AiAccessSettingsSection actions={actions} offline={false} />)

    await waitFor(() => {
      expect(screen.getByText('+ New token')).toBeDefined()
    })

    fireEvent.click(screen.getByText('+ New token'))
    expect(screen.getByPlaceholderText('e.g. Claude Code')).toBeDefined()

    // Submit with empty name
    fireEvent.click(screen.getByText('Create token'))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Give the token a name.')
    })
  })

  it('creates token, shows the reveal with warning exactly once, then Done returns to list without plaintext', async () => {
    const { unmount } = render(<AiAccessSettingsSection actions={actions} offline={false} />)

    await waitFor(() => {
      expect(screen.getByText('+ New token')).toBeDefined()
    })

    fireEvent.click(screen.getByText('+ New token'))

    const nameInput = screen.getByPlaceholderText('e.g. Claude Code')
    fireEvent.change(nameInput, { target: { value: 'Claude Code' } })

    fireEvent.click(screen.getByText('Create token'))

    // One-time reveal
    await waitFor(() => {
      expect(screen.getByText('Token "Claude Code" created')).toBeDefined()
      expect(
        screen.getByText('rh_pat_AbC1234567890abcdefghijklmnopqrstuvwxyz1234'),
      ).toBeDefined()
      expect(
        screen.getByText(/You will not see this token again\./),
      ).toBeDefined()
    })

    // Both export lines
    expect(screen.getByText(/export REPERTOIRE_HERO_URL=/)).toBeDefined()
    expect(screen.getByText(/export REPERTOIRE_HERO_TOKEN=rh_pat_AbC1234567890abcdefghijklmnopqrstuvwxyz1234/)).toBeDefined()

    // Click Done
    fireEvent.click(screen.getByText('Done'))

    // The reveal and full plaintext are gone; token row shows name, prefix, and scopes
    await waitFor(() => {
      expect(screen.queryByText(/You will not see this token again\./)).toBeNull()
      expect(screen.queryByText('rh_pat_AbC1234567890abcdefghijklmnopqrstuvwxyz1234')).toBeNull()
      expect(screen.getByText('Claude Code')).toBeDefined()
      expect(screen.getByText('rh_pat_AbC1…')).toBeDefined()
      expect(screen.getByText('read')).toBeDefined()
    })

    // Remount: token plaintext is still gone
    unmount()
    render(<AiAccessSettingsSection actions={actions} offline={false} />)

    await waitFor(() => {
      expect(screen.queryByText('rh_pat_AbC1234567890abcdefghijklmnopqrstuvwxyz1234')).toBeNull()
      expect(screen.getByText('Claude Code')).toBeDefined()
      expect(screen.getByText('rh_pat_AbC1…')).toBeDefined()
    })
  })

  it('asks for confirmation when Revoke is clicked and removes the row on confirm', async () => {
    tokensStore = [
      {
        id: 'tok-rev',
        userId: 'u1',
        name: 'Agent to Revoke',
        tokenPrefix: 'rh_pat_X9yZ',
        scopes: ['read'],
        createdAt: '2026-10-27T10:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      },
    ]

    render(<AiAccessSettingsSection actions={actions} offline={false} />)

    await waitFor(() => {
      expect(screen.getByText('Agent to Revoke')).toBeDefined()
    })

    // Click Revoke
    fireEvent.click(screen.getByText('Revoke'))

    // Confirmation panel appears
    await waitFor(() => {
      expect(
        screen.getByText('Revoke "Agent to Revoke"? Agents using it stop working immediately.'),
      ).toBeDefined()
    })

    // Click Confirm Revoke inside ConfirmPanel
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' })
    // The second button is inside the ConfirmPanel
    fireEvent.click(revokeButtons[revokeButtons.length - 1])

    await waitFor(() => {
      expect(actions.revokeToken).toHaveBeenCalledWith('tok-rev')
      expect(screen.queryByText('Agent to Revoke')).toBeNull()
    })
  })

  it('renders loading state initially while tokens are being fetched', async () => {
    let resolveList: (val: { tokens: ApiTokenRecord[] }) => void
    actions.listTokens = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveList = resolve
        }),
    )

    render(<AiAccessSettingsSection actions={actions} offline={false} />)
    expect(screen.getByText('Loading tokens…')).toBeDefined()

    resolveList!({ tokens: [] })
    await waitFor(() => {
      expect(
        screen.getByText('No tokens yet. Create one to let an AI agent work on your songs.'),
      ).toBeDefined()
    })
  })

  it('renders error message when token listing fails', async () => {
    actions.listTokens = vi.fn(async () => ({ error: 'Database unavailable' }))
    render(<AiAccessSettingsSection actions={actions} offline={false} />)

    await waitFor(() => {
      expect(screen.getByText('Database unavailable')).toBeDefined()
    })
  })
})

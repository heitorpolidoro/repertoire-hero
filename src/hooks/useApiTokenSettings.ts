/**
 * RH-187: Controller hook for the Settings "AI access" section.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ApiTokenRecord } from '@/lib/apiTokens'
import type { ApiTokenExpiryOption, ApiTokenScope } from '@/lib/apiTokenRules'

export interface ApiTokenSettingsActions {
  listTokens: () => Promise<{ tokens?: ApiTokenRecord[]; error?: string }>
  createToken: (params: {
    name: string
    scopes: ApiTokenScope[]
    expiryDays?: ApiTokenExpiryOption
  }) => Promise<{ token?: ApiTokenRecord; plaintext?: string; error?: string }>
  revokeToken: (tokenId: string) => Promise<{ success?: boolean; error?: string }>
}

export interface UseApiTokenSettingsOptions {
  actions: ApiTokenSettingsActions
}

export interface ApiTokenSettingsController {
  tokens: ApiTokenRecord[] | null
  busy: boolean
  error: string | null
  isCreating: boolean
  nameDraft: string
  scopesDraft: ApiTokenScope[]
  expiryDraft: ApiTokenExpiryOption
  reveal: { tokenName: string; plaintext: string } | null
  pendingRevokeId: string | null
  startCreate: () => void
  cancelCreate: () => void
  setNameDraft: (name: string) => void
  toggleScopeDraft: (scope: ApiTokenScope) => void
  setExpiryDraft: (expiry: ApiTokenExpiryOption) => void
  submitCreate: () => Promise<void>
  dismissReveal: () => void
  requestRevoke: (tokenId: string) => void
  cancelRevoke: () => void
  confirmRevoke: () => Promise<void>
}

export function useApiTokenSettings({
  actions,
}: UseApiTokenSettingsOptions): ApiTokenSettingsController {
  const [tokens, setTokens] = useState<ApiTokenRecord[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isCreating, setIsCreating] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [scopesDraft, setScopesDraft] = useState<ApiTokenScope[]>(['read'])
  const [expiryDraft, setExpiryDraft] = useState<ApiTokenExpiryOption>(90)

  const [reveal, setReveal] = useState<{ tokenName: string; plaintext: string } | null>(null)
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null)

  const loadTokens = useCallback(async () => {
    try {
      const res = await actions.listTokens()
      if (res.tokens) {
        setTokens(res.tokens)
      } else if (res.error) {
        setError(res.error)
      }
    } catch {
      setError('Could not load your AI access tokens.')
    }
  }, [actions])

  useEffect(() => {
    let alive = true
    actions.listTokens().then(
      (res) => {
        if (!alive) return
        if (res.tokens) {
          setTokens(res.tokens)
        } else if (res.error) {
          setError(res.error)
        }
      },
      () => {
        if (alive) setError('Could not load your AI access tokens.')
      },
    )
    return () => {
      alive = false
    }
  }, [actions])

  const startCreate = useCallback(() => {
    setIsCreating(true)
    setError(null)
    setNameDraft('')
    setScopesDraft(['read'])
    setExpiryDraft(90)
  }, [])

  const cancelCreate = useCallback(() => {
    setIsCreating(false)
    setError(null)
  }, [])

  const toggleScopeDraft = useCallback((scope: ApiTokenScope) => {
    setScopesDraft((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
  }, [])

  const submitCreate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await actions.createToken({
        name: nameDraft,
        scopes: scopesDraft,
        expiryDays: expiryDraft,
      })

      if (res.error) {
        setError(res.error)
      } else if (res.token && res.plaintext) {
        setIsCreating(false)
        setReveal({
          tokenName: res.token.name,
          plaintext: res.plaintext,
        })
        await loadTokens()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token')
    } finally {
      setBusy(false)
    }
  }, [actions, nameDraft, scopesDraft, expiryDraft, loadTokens])

  const dismissReveal = useCallback(() => {
    setReveal(null)
  }, [])

  const requestRevoke = useCallback((tokenId: string) => {
    setPendingRevokeId(tokenId)
    setError(null)
  }, [])

  const cancelRevoke = useCallback(() => {
    setPendingRevokeId(null)
  }, [])

  const confirmRevoke = useCallback(async () => {
    if (!pendingRevokeId) return
    setBusy(true)
    setError(null)
    try {
      const res = await actions.revokeToken(pendingRevokeId)
      if (res.error) {
        setError(res.error)
      } else {
        setPendingRevokeId(null)
        await loadTokens()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token')
    } finally {
      setBusy(false)
    }
  }, [actions, pendingRevokeId, loadTokens])

  return {
    tokens,
    busy,
    error,
    isCreating,
    nameDraft,
    scopesDraft,
    expiryDraft,
    reveal,
    pendingRevokeId,
    startCreate,
    cancelCreate,
    setNameDraft,
    toggleScopeDraft,
    setExpiryDraft,
    submitCreate,
    dismissReveal,
    requestRevoke,
    cancelRevoke,
    confirmRevoke,
  }
}

'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  createApiToken,
  listActiveApiTokens,
  revokeApiToken,
  type ApiTokenRecord,
} from '@/lib/apiTokens'
import type { ApiTokenExpiryOption, ApiTokenScope } from '@/lib/apiTokenRules'

export async function listApiTokensAction(): Promise<{
  tokens?: ApiTokenRecord[]
  error?: string
}> {
  try {
    const userId = await getRequiredUserId()
    const tokens = await listActiveApiTokens(userId)
    return { tokens }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list API tokens'
    return { error: message }
  }
}

export async function createApiTokenAction(params: {
  name: string
  scopes: ApiTokenScope[]
  expiryDays?: ApiTokenExpiryOption
}): Promise<{
  token?: ApiTokenRecord
  plaintext?: string
  error?: string
}> {
  try {
    const userId = await getRequiredUserId()
    const result = await createApiToken(userId, params)
    return { token: result.token, plaintext: result.plaintext }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create API token'
    return { error: message }
  }
}

export async function revokeApiTokenAction(tokenId: string): Promise<{
  success?: boolean
  error?: string
}> {
  try {
    const userId = await getRequiredUserId()
    const success = await revokeApiToken(userId, tokenId)
    return { success }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revoke API token'
    return { error: message }
  }
}

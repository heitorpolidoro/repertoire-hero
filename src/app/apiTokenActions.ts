/**
 * RH-187: The personal access token Server Actions, bundled for client injection (F21).
 */
import {
  listApiTokensAction,
  createApiTokenAction,
  revokeApiTokenAction,
} from '@/app/actions/apiTokens'
import type { ApiTokenSettingsActions } from '@/hooks/useApiTokenSettings'

export const API_TOKEN_SETTINGS_ACTIONS: ApiTokenSettingsActions = {
  listTokens: listApiTokensAction,
  createToken: createApiTokenAction,
  revokeToken: revokeApiTokenAction,
}

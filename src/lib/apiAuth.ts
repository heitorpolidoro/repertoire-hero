/**
 * RH-187: Bearer token authentication guard for /api/v1 route handlers.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { parseBearerToken, type ApiTokenScope } from '@/lib/apiTokenRules'
import { resolveActiveApiToken, touchApiTokenLastUsed } from '@/lib/apiTokens'

export function jsonError(
  message: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: message }, { status, headers })
}

export type ApiRouteContext<P = Record<string, string>> = {
  params: Promise<P>
}

export type ApiAuthenticatedContext<P = Record<string, string>> = {
  userId: string
  params: Promise<P>
}

export type ApiHandler<P = Record<string, string>> = (
  request: NextRequest,
  context: ApiAuthenticatedContext<P>,
) => Promise<Response>

/**
 * Higher-order function that wraps a route handler with Bearer token authentication.
 * Refuses missing/invalid tokens with 401 and missing scopes with 403.
 * Never reads session cookies.
 */
export function withApiAuth<P = Record<string, string>>(
  requiredScope: ApiTokenScope,
  handler: ApiHandler<P>,
): (request: NextRequest, context: ApiRouteContext<P>) => Promise<Response> {
  return async (request: NextRequest, context: ApiRouteContext<P>): Promise<Response> => {
    try {
      const authHeader = request.headers.get('authorization')
      const parsedToken = parseBearerToken(authHeader)

      if (!parsedToken) {
        return jsonError('Missing or invalid API token', 401, {
          'WWW-Authenticate': 'Bearer',
        })
      }

      const tokenRecord = await resolveActiveApiToken(parsedToken)
      if (!tokenRecord) {
        return jsonError('Missing or invalid API token', 401, {
          'WWW-Authenticate': 'Bearer',
        })
      }

      if (!tokenRecord.scopes.includes(requiredScope)) {
        return jsonError(`This token lacks the ${requiredScope} scope`, 403)
      }

      // Best-effort update of last_used_at
      void Promise.resolve(touchApiTokenLastUsed(tokenRecord.id)).catch(() => {})

      return await handler(request, {
        userId: tokenRecord.userId,
        params: context.params,
      })
    } catch (error) {
      logger.error('Unexpected error in API v1 endpoint', error instanceof Error ? error : undefined)
      return jsonError('Internal error', 500)
    }
  }
}

/**
 * Structured client-side logger.
 *
 * In production:
 *   - Forwards breadcrumbs to Sentry (info / warn).
 *   - Captures exceptions or messages to Sentry (error).
 *
 * In development:
 *   - Always writes to the browser / Node console regardless of environment,
 *     so engineers get immediate feedback during local work.
 */

import * as Sentry from '@sentry/nextjs'

const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  /**
   * Log an informational message.
   * Adds a Sentry breadcrumb in production; always logs to console in development.
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (isDev) {
       
      console.info('[info]', message, context ?? '')
    }

    Sentry.addBreadcrumb({
      level: 'info',
      message,
      data: context,
    })
  },

  /**
   * Log a warning.
   * Adds a Sentry breadcrumb with level "warning" in production; also logs to
   * console in development.
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (isDev) {
       
      console.warn('[warn]', message, context ?? '')
    }

    Sentry.addBreadcrumb({
      level: 'warning',
      message,
      data: context,
    })
  },

  /**
   * Log an error.
   *
   * - If `error` is an `Error` instance, calls `Sentry.captureException`.
   * - Otherwise, calls `Sentry.captureMessage` at "error" severity.
   * - Always logs to console in development.
   *
   * Call this *before* re-throwing so the event reaches Sentry even when the
   * caller swallows the exception.
   */
  error(
    message: string,
    error?: unknown,
    context?: Record<string, unknown>
  ): void {
    if (isDev) {
       
      console.error('[error]', message, error ?? '', context ?? '')
    }

    if (error instanceof Error) {
      Sentry.captureException(error, {
        extra: { message, ...context },
      })
    } else {
      Sentry.captureMessage(message, {
        level: 'error',
        extra: { error, ...context },
      })
    }
  },
}

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Minimal sampling for edge functions.
  tracesSampleRate: 1.0,

  debug: false,
})

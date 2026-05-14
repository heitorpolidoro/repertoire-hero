import * as Sentry from '@sentry/nextjs'

Sentry.init({
  // Server-side DSN is kept out of the public bundle.
  dsn: process.env.SENTRY_DSN,

  // Capture all traces on the server; tune down in high-traffic scenarios.
  tracesSampleRate: 1.0,

  debug: false,
})

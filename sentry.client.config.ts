import * as Sentry from '@sentry/nextjs'
import { replayIntegration } from '@sentry/browser'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10 % of traces in production; adjust as needed.
  tracesSampleRate: 1.0,

  // Session Replay: only enable in production to avoid noise during development.
  replaysSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  replaysOnErrorSampleRate: process.env.NODE_ENV === 'production' ? 1.0 : 0,

  integrations:
    process.env.NODE_ENV === 'production' ? [replayIntegration()] : [],

  debug: false,
})

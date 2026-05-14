import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  reactCompiler: true,
}

export default withSentryConfig(nextConfig, {
  // Sentry organization and project slugs (set in CI / Vercel env vars).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token required for source map upload.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps so stack traces are human-readable in Sentry,
  // then delete the .map files from the public output so they are not served.
  sourcemaps: {
    disable: false,
    filesToDeleteAfterUpload: ['.next/static/**/*.map'],
  },

  // Do not send Sentry SDK telemetry data.
  telemetry: false,

  // Suppress the Sentry CLI output during builds.
  silent: true,
})

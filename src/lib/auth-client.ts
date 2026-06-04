import { createAuthClient } from 'better-auth/react'

// Use the current page origin in the browser so the auth client always hits
// the same host — avoids CORS issues when accessing via 127.0.0.1 vs localhost.
const baseURL =
  typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')

export const authClient = createAuthClient({ baseURL })

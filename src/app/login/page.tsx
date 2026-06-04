'use client'

import { authClient } from '@/lib/auth-client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface DevProfile {
  id: string
  email: string
  full_name: string | null
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [devProfiles, setDevProfiles] = useState<DevProfile[]>([])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    // Fetch real names from DB (requires SUPABASE_SERVICE_ROLE_KEY).
    // Falls back to seed users if the key is absent or the request fails.
    fetch('/api/dev/profiles')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Dev profiles fetch failed'))))
      .then((data: DevProfile[]) => {
        if (Array.isArray(data) && data.length > 0) setDevProfiles(data)
      })
      .catch(() => {
        // No service role key or local Supabase not running — use seed list
        setDevProfiles([
          { id: 'seed-1', email: 'com.spotify@exemple.com', full_name: 'Com Spotify' },
          { id: 'seed-2', email: 'sem_spotify@exemple.com', full_name: 'Sem Spotify' },
        ])
      })
  }, [])

  const signUpHref = redirect !== '/' ? `/signup?redirect=${encodeURIComponent(redirect)}` : '/signup'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message ?? 'Sign in failed')
      setLoading(false)
      return
    }

    router.push(redirect)
    router.refresh()
  }

  async function handleFastLogin(email: string) {
    setError(null)
    setLoading(true)

    const { error: signInError } = await authClient.signIn.email({
      email,
      password: 'password',
    })

    if (signInError) {
      setError(signInError.message ?? 'Sign in failed')
      setLoading(false)
      return
    }

    router.push(redirect)
    router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Repertoire Hero</h1>
          <p className="mt-2 text-sm text-gray-500">
            Sign in to manage your music
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white shadow-md rounded-2xl px-8 py-8 space-y-6"
        >
          <h2 className="text-lg font-semibold text-gray-900">Sign In</h2>

          {process.env.NODE_ENV === 'development' && devProfiles.length > 0 && (
            <div className="space-y-3 mb-6 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider text-center">Dev Fast Login</p>
              <div className="flex flex-col gap-2">
                {devProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => handleFastLogin(profile.email)}
                    disabled={loading}
                    className="w-full py-2 px-4 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-sm font-medium rounded-lg transition-colors border border-emerald-200"
                  >
                    {profile.full_name ?? profile.email.split('@')[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link
              href={signUpHref}
              className="font-medium text-emerald-600 hover:text-emerald-500"
            >
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

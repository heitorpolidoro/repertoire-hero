'use client'

import { authClient } from '@/lib/auth-client'
import { InstrumentPicker } from '@/components/profile/InstrumentPicker'
import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function SignUpForm() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') ?? '/'

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [instruments, setInstruments] = useState<string[]>([])
  const [primaryInstrument, setPrimaryInstrument] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const loginHref = redirect !== '/' ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    const { error: signUpError } = await authClient.signUp.email({
      email,
      password,
      name: fullName.trim() || email.split('@')[0],
    })

    if (signUpError) {
      setError(signUpError.message ?? 'Sign up failed')
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900">Repertoire Hero</h1>
          </div>

          <div className="bg-white shadow-md rounded-2xl px-8 py-8 space-y-5 text-center">
            <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-3">
              Account created! You can now sign in.
            </p>
            {redirect !== '/' && (
              <p className="text-xs text-gray-500">
                After confirming, go back to your invite link to join the band.
              </p>
            )}
            <Link
              href={loginHref}
              className="inline-block text-sm font-medium text-emerald-600 hover:text-emerald-500"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Repertoire Hero</h1>
          <p className="mt-2 text-sm text-gray-500">
            Create your account to get started
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white shadow-md rounded-2xl px-8 py-8 space-y-6"
        >
          <h2 className="text-lg font-semibold text-gray-900">Create Account</h2>

          {/* Account fields */}
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="full-name" className="block text-sm font-medium text-gray-700">
                Full name <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="full-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="Your name"
              />
            </div>

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
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
          </div>

          {/* Instruments */}
          <div className="space-y-2 border-t border-gray-100 pt-5">
            <label className="block text-sm font-medium text-gray-700">
              Instruments <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <p className="text-xs text-gray-400">
              Select all you play. Click the star on a selected instrument to mark it as primary.
            </p>
            <InstrumentPicker
              selected={instruments}
              primary={primaryInstrument}
              onChange={(sel, pri) => {
                setInstruments(sel)
                setPrimaryInstrument(pri)
              }}
            />
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
            {loading ? 'Creating account...' : 'Create Account'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link
              href={loginHref}
              className="font-medium text-emerald-600 hover:text-emerald-500"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  )
}

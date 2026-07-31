'use client'

import { authClient } from '@/lib/auth-client'
import Link from 'next/link'
import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const redirectTo = `${window.location.origin}/reset-password`

    const { error: forgotError } = await (authClient as any).forgetPassword({
      email: email.trim(),
      redirectTo,
    })

    if (forgotError) {
      setError(forgotError.message ?? 'Failed to send password reset request')
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Repertoire Hero</h1>
          <p className="mt-2 text-sm text-gray-500">
            Recover your account access
          </p>
        </div>

        <div className="bg-white shadow-md rounded-2xl px-8 py-8 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">Reset Password</h2>

          {success ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 text-emerald-800 rounded-xl p-4 border border-emerald-100 text-sm">
                <p className="font-semibold mb-1">Check your email</p>
                <p>We sent a password reset link to <strong>{email}</strong>. Please check your inbox and follow the instructions.</p>
              </div>
              <Link
                href="/login"
                className="block w-full text-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <p className="text-sm text-gray-500">
                Enter your email address and we will send you a link to reset your password.
              </p>

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

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Sending link...' : 'Send reset link'}
                </button>

                <Link
                  href="/login"
                  className="block w-full text-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

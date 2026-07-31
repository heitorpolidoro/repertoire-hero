'use client'

import { authClient } from '@/lib/auth-client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, useEffect } from 'react'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [token, setToken] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = searchParams.get('token')
    setToken(t)
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!token) {
      setError('Invalid or expired reset token. Please request a new link.')
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    const { error: resetError } = await authClient.resetPassword({
      newPassword,
      token,
    })

    if (resetError) {
      setError(resetError.message ?? 'Failed to reset password')
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
    
    // Auto redirect to login after 3 seconds
    setTimeout(() => {
      router.push('/login')
    }, 3000)
  }

  // Token missing check
  const isTokenMissing = token === null

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Repertoire Hero</h1>
          <p className="mt-2 text-sm text-gray-500">
            Choose your new password
          </p>
        </div>

        <div className="bg-white shadow-md rounded-2xl px-8 py-8 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">Set New Password</h2>

          {isTokenMissing ? (
            <div className="space-y-4">
              <div className="bg-red-50 text-red-800 rounded-xl p-4 border border-red-100 text-sm">
                <p className="font-semibold mb-1">Invalid Link</p>
                <p>The password reset token is missing from the URL. Please request a new link from the forgot password page.</p>
              </div>
              <Link
                href="/forgot-password"
                className="block w-full text-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                Request New Link
              </Link>
              <Link
                href="/login"
                className="block w-full text-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back to Sign In
              </Link>
            </div>
          ) : success ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 text-emerald-800 rounded-xl p-4 border border-emerald-100 text-sm">
                <p className="font-semibold mb-1">Password updated!</p>
                <p>Your password has been successfully reset. Redirecting you to the sign in page...</p>
              </div>
              <Link
                href="/login"
                className="block w-full text-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                Sign In Now
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                  New Password
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="••••••••"
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
                {loading ? 'Updating password...' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}

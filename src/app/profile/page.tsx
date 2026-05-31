'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { getProfile, updateProfile, updateEmail } from '@/lib/profile'
import { InstrumentPicker } from '@/components/profile/InstrumentPicker'
import type { Profile } from '@/types/database'

export default function ProfilePage() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [emailSaving, setEmailSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [fullName, setFullName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [instruments, setInstruments] = useState<string[]>([])
  const [primaryInstrument, setPrimaryInstrument] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [newEmail, setNewEmail] = useState('')

  useEffect(() => {
    getProfile()
      .then((p) => {
        if (!p) return
        setProfile(p)
        setFullName(p.full_name ?? '')
        setAvatarUrl(p.avatar_url ?? '')
        setInstruments(p.instruments ?? [])
        setPrimaryInstrument(p.primary_instrument ?? null)
        setEmail(p.email)
        setNewEmail(p.email)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load profile'))
      .finally(() => setLoading(false))
  }, [])

  const handleSaveProfile = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await updateProfile({
        full_name: fullName.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        instruments,
        primary_instrument: primaryInstrument,
      })
      setProfile((prev) =>
        prev ? { ...prev, full_name: fullName.trim() || null, avatar_url: avatarUrl.trim() || null, instruments, primary_instrument: primaryInstrument } : prev
      )
      setSuccess('Profile saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateEmail = async () => {
    if (!newEmail.trim() || newEmail === email) return
    setEmailSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await updateEmail(newEmail.trim())
      setSuccess(`Confirmation email sent to ${newEmail.trim()}. Check your inbox to complete the change.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update email')
    } finally {
      setEmailSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Loading...
      </div>
    )
  }

  const avatarPreview = avatarUrl.trim()

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 md:px-6">
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 flex flex-col gap-6 max-w-lg">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-red-700">{error}</p>
            <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs focus:outline-none">x</button>
          </div>
        )}
        {success && (
          <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-green-700">{success}</p>
            <button type="button" onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 text-xs focus:outline-none">x</button>
          </div>
        )}

        {/* Photo */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Photo</h2>
          <div className="flex items-center gap-4">
            <div className="shrink-0 h-[72px] w-[72px]">
              {avatarPreview ? (
                <Image
                  src={avatarPreview}
                  alt="Profile photo"
                  width={72}
                  height={72}
                  className="h-[72px] w-[72px] rounded-full object-cover border border-gray-200"
                  unoptimized
                />
              ) : (
                <div className="h-[72px] w-[72px] rounded-full bg-emerald-100 flex items-center justify-center text-2xl font-semibold text-emerald-400 border border-emerald-200 select-none">
                  {fullName.trim() ? fullName.trim()[0].toUpperCase() : '?'}
                </div>
              )}
            </div>
            <div className="flex-1">
              <label htmlFor="avatar-url" className="text-xs font-medium text-gray-600 block mb-1">Image URL</label>
              <input
                id="avatar-url"
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </section>

        {/* Name */}
        <section className="flex flex-col gap-2">
          <label htmlFor="full-name" className="text-sm font-semibold text-gray-700">Name</label>
          <input
            id="full-name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </section>

        {/* Instruments */}
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Instruments</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {instruments.length === 0
                ? 'Select one or more. The first becomes your primary.'
                : primaryInstrument
                  ? `Primary: ${primaryInstrument} - Click star on any selected to change it`
                  : 'Click the star to set your primary instrument'}
            </p>
          </div>
          <InstrumentPicker
            selected={instruments}
            primary={primaryInstrument}
            onChange={(sel, prim) => { setInstruments(sel); setPrimaryInstrument(prim) }}
          />
        </section>

        {/* Save */}
        <button
          type="button"
          onClick={() => { handleSaveProfile(); }}
          disabled={saving}
          className="self-start px-5 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save profile'}
        </button>

        <hr className="border-gray-100" />

        {/* Email */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Email</h2>
          <div className="flex gap-2">
            <input
              id="email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={() => { handleUpdateEmail(); }}
              disabled={emailSaving || !newEmail.trim() || newEmail === email}
              className="shrink-0 px-4 py-2 rounded-md bg-gray-800 text-white text-sm font-medium hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {emailSaving ? 'Sending...' : 'Change'}
            </button>
          </div>
          {newEmail !== email && newEmail.trim() && (
            <p className="text-xs text-amber-600">A confirmation link will be sent to {newEmail.trim()}.</p>
          )}
        </section>
      </div>
    </div>
  )
}

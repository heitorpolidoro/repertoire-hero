'use client'

import { useState, useEffect } from 'react'
import { COOKIE_NAME, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n'

function getLocaleCookie(): Locale {
  if (typeof document === 'undefined') return 'pt-BR'
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`))
  const val = match ? decodeURIComponent(match[1]) : null
  return val === 'en' ? 'en' : 'pt-BR'
}

export function LanguageSelector() {
  const [currentLocale, setCurrentLocale] = useState<Locale>('pt-BR')

  useEffect(() => {
    setCurrentLocale(getLocaleCookie())
  }, [])

  const handleLanguageChange = (newLocale: Locale) => {
    document.cookie = `${COOKIE_NAME}=${newLocale}; path=/; max-age=31536000; SameSite=Lax`
    setCurrentLocale(newLocale)
    window.location.reload()
  }

  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      <span className="sr-only">Select Language</span>
      <select
        value={currentLocale}
        onChange={(e) => handleLanguageChange(e.target.value as Locale)}
        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none"
        aria-label="Language selector"
      >
        <option value="pt-BR">Português (BR)</option>
        <option value="en">English</option>
      </select>
    </div>
  )
}

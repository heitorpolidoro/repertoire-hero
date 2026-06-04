'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { getBandsAction } from '@/app/actions/bands'
import { useBandContextStore } from '@/store/bandContextStore'
import { useRepertoireStore } from '@/store/repertoireStore'

interface SidebarProps {
  activeItem: string
}

interface Band {
  id: string
  name: string
  role: 'admin' | 'member'
}

export default function Sidebar({ activeItem }: SidebarProps) {
  const { data: session } = authClient.useSession()
  const user = session?.user ?? null
  const router = useRouter()

  const { context, setUserContext, setBandContext } = useBandContextStore()
  const loadSongs = useRepertoireStore((s) => s.loadSongs)

  const [bands, setBands] = useState<Band[]>([])
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getBandsAction().then((b) => setBands(b as unknown as Band[]))
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const switchContext = (next: { type: 'user' } | { type: 'band'; id: string; name: string }) => {
    if (next.type === 'user') setUserContext()
    else setBandContext(next.id, next.name)
    setOpen(false)
    loadSongs()
    router.push('/')
  }

  const currentLabel =
    context.type === 'band' ? context.name : user?.name ?? user?.email?.split('@')[0] ?? 'Pessoal'

  const menuItems = [
    { href: '/', label: 'Dashboard' },
    { href: '/playlists', label: 'Playlists' },
    { href: '/songs', label: 'Songs' },
    { href: '/bands', label: 'Bandas' },
    { href: '/settings', label: 'Settings' },
  ]

  const handleSignOut = async () => {
    setUserContext()
    await authClient.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-64 bg-black border-r border-gray-800 flex flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white">🎵 Repertoire Hero</h1>
      </div>

      {/* Context switcher */}
      {user && (
        <div className="px-4 pb-4" ref={dropdownRef}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {context.type === 'band' ? '🎸' : (user.name ?? user.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <span className="flex-1 text-white text-sm font-medium truncate">{currentLabel}</span>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {open && (
            <div className="mt-1 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden shadow-lg z-10 relative">
              <button
                onClick={() => switchContext({ type: 'user' })}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-800 transition-colors ${context.type === 'user' ? 'text-emerald-400' : 'text-gray-300'}`}
              >
                <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-bold">
                  {(user.name ?? user.email ?? '?').charAt(0).toUpperCase()}
                </div>
                <span className="truncate">{user.name ?? user.email?.split('@')[0]}</span>
                {context.type === 'user' && <span className="ml-auto">✓</span>}
              </button>

              {bands.length > 0 && (
                <>
                  <div className="border-t border-gray-700 px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wider">
                    Bandas
                  </div>
                  {bands.map((band) => (
                    <button
                      key={band.id}
                      onClick={() => switchContext({ type: 'band', id: band.id, name: band.name })}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-800 transition-colors ${context.type === 'band' && context.id === band.id ? 'text-emerald-400' : 'text-gray-300'}`}
                    >
                      <div className="w-6 h-6 rounded-full bg-purple-700 flex items-center justify-center text-white text-xs">
                        🎸
                      </div>
                      <span className="truncate">{band.name}</span>
                      {context.type === 'band' && context.id === band.id && (
                        <span className="ml-auto">✓</span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {context.type === 'band' && (
            <div className="mt-2 flex items-center gap-1.5 px-2 py-1 bg-purple-900/40 border border-purple-700/50 rounded text-xs text-purple-300">
              <span>🎸</span>
              <span className="truncate">Modo banda</span>
              <button
                onClick={() => switchContext({ type: 'user' })}
                className="ml-auto text-purple-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      <nav className="flex-1">
        {menuItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`flex items-center px-6 py-3 text-gray-300 hover:text-white transition-colors ${
              activeItem === item.label
                ? 'text-white bg-gray-900 border-r-4 border-emerald-500'
                : 'hover:bg-gray-900'
            }`}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {user && (
        <div className="p-6 border-t border-gray-800">
          <button onClick={handleSignOut} className="w-full text-left text-gray-400 hover:text-white text-sm">
            Sign out
          </button>
        </div>
      )}
    </aside>
  )
}

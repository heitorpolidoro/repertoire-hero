'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Repertoire, RepertoireTab, SongStatus, SongLink } from '@/types/database'
import { STATUS_CONFIG } from '@/lib/statusConfig'
import { getSongEntryAction as getSongEntry, updateLyricsAction, fetchLyricsAction, updateSongStatusAction, updateSongLinksAction, getPersonalEntryForSongAction, addSongAction } from '@/app/actions/repertoire'
import { getTabsAction, uploadTabAction, deleteTabAction } from '@/app/actions/tabs'

function parseLyricsMarkdown(text: string) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/__(.*?)__/g, '<u>$1</u>')
    .replace(/\[(.*?)\]/g, '<strong class="text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 text-xs font-semibold select-all">$1</strong>')
  return html
}

function getLinkIcon(url: string) {
  const lowercaseUrl = url.toLowerCase()
  
  if (lowercaseUrl.includes('spotify.com')) {
    return (
      <svg className="w-5 h-5 text-[#1DB954] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.893-.982-.336.075-.67-.136-.75-.472-.075-.336.136-.67.472-.75 3.856-.882 7.15-.508 9.825 1.13.295.18.387.565.207.865zm1.224-2.722c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.082-1.182-.413.125-.85-.107-.975-.52-.125-.413.107-.85.52-.975 3.666-1.112 8.243-.574 11.378 1.353.367.226.487.707.26 1.074zm.107-2.825C14.398 8.66 8.398 8.462 4.907 9.522c-.53.16-1.09-.14-1.25-.67-.16-.53.14-1.09.67-1.25 3.997-1.213 10.63-1.002 14.735 1.442.477.283.633.9.35 1.377-.283.477-.9.633-1.377.35z"/>
      </svg>
    )
  }
  
  if (lowercaseUrl.includes('youtube.com') || lowercaseUrl.includes('youtu.be')) {
    return (
      <svg className="w-5 h-5 text-[#FF0000] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.518 3.545 12 3.545 12 3.545s-7.518 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11C4.482 20.455 12 20.455 12 20.455s7.518 0 9.388-.508a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    )
  }
  
  if (lowercaseUrl.includes('cifraclub.com.br') || lowercaseUrl.includes('cifraclub.com') || lowercaseUrl.includes('ultimate-guitar.com')) {
    return (
      <svg className="w-5 h-5 text-[#FFB600] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    )
  }
  
  if (lowercaseUrl.includes('drive.google.com') || lowercaseUrl.includes('docs.google.com') || lowercaseUrl.endsWith('.pdf')) {
    return (
      <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )
  }
  
  // Generic Link Icon
  return (
    <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  )
}

export default function FastViewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [entry, setEntry] = useState<Repertoire | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Tabs state
  const [tabs, setTabs] = useState<RepertoireTab[]>([])
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // PDF Viewer state
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null)
  const [activeTabTitle, setActiveTabTitle] = useState('')

  // Lyrics state
  const [isEditingLyrics, setIsEditingLyrics] = useState(false)
  const [lyricsText, setLyricsText] = useState('')
  const [savingLyrics, setSavingLyrics] = useState(false)
  const [fetchingLyrics, setFetchingLyrics] = useState(false)

  // Status changing state
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // Links editing state
  const [isAddingLink, setIsAddingLink] = useState(false)
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')
  const [savingLink, setSavingLink] = useState(false)

  // Stage mode states
  const [isStageMode, setIsStageMode] = useState(false)
  const [lyricsFontSize, setLyricsFontSize] = useState(18)
  const [isStageDarkMode, setIsStageDarkMode] = useState(false)

  // Band vs Personal aggregation states
  const [personalEntry, setPersonalEntry] = useState<Repertoire | null>(null)
  const [personalTabs, setPersonalTabs] = useState<RepertoireTab[]>([])
  const [showPersonalLyrics, setShowPersonalLyrics] = useState(false)
  const [uploadDestination, setUploadDestination] = useState<'band' | 'personal'>('band')
  const [showUploadDestModal, setShowUploadDestModal] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const queryBandId = params ? params.get('bandId') : null

        const [data, tabData] = await Promise.all([
          getSongEntry(id, queryBandId),
          getTabsAction(id).catch(() => [] as RepertoireTab[]),
        ])

        if (!cancelled) {
          if (!data) {
            setNotFound(true)
          } else {
            setEntry(data)
            setTabs(tabData)
            setLyricsText(data.lyrics ?? '')

            // If we are in band context, fetch personal entry and tabs in background
            if (queryBandId && data.song_id) {
              getPersonalEntryForSongAction(data.song_id).then(async (pEntry) => {
                if (pEntry && !cancelled) {
                  setPersonalEntry(pEntry)
                  try {
                    const pTabs = await getTabsAction(pEntry.id)
                    if (!cancelled) {
                      setPersonalTabs(pTabs)
                    }
                  } catch (e) {
                    console.error('Failed to load personal tabs', e)
                  }
                }
              }).catch((e) => {
                console.error('Failed to load personal entry', e)
              })
            }
          }
        }
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" aria-busy="true">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (notFound || !entry) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-gray-700">Song not found</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
        >
          &larr; Back
        </button>
      </div>
    )
  }

  const title = entry.song?.title ?? '(untitled)'
  const artist = entry.song?.artist ?? ''
  const key = entry.personal_key ?? entry.song?.standard_key
  const cfg = STATUS_CONFIG[entry.status]
  const links = entry.song?.links ?? []

  const mergedTabs = [
    ...tabs.map(t => ({ ...t, origin: 'band' as const })),
    ...personalTabs.map(t => ({ ...t, origin: 'personal' as const }))
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const hasDifferentPersonalLyrics = !!(entry.band_id && personalEntry && personalEntry.lyrics && personalEntry.lyrics !== entry.lyrics)
  const displayedLyrics = (entry.band_id && showPersonalLyrics && personalEntry) ? personalEntry.lyrics : entry.lyrics

  // Trigger upload click to decide destination (personal vs band)
  function handleUploadClick(e: React.FormEvent) {
    e.preventDefault()
    if (!entry || !uploadFile) return

    if (entry.band_id) {
      setShowUploadDestModal(true)
    } else {
      triggerUpload('personal')
    }
  }

  // Real upload function
  async function triggerUpload(destination: 'band' | 'personal') {
    if (!entry || !uploadFile) return

    try {
      setUploading(true)
      setUploadError(null)

      let targetRepertoireId = entry.id
      let isPersonal = destination === 'personal'

      if (entry.band_id) {
        if (isPersonal) {
          let pEntry = personalEntry
          if (!pEntry) {
            // Auto-create personal repertoire entry if not present
            pEntry = await addSongAction(entry.song_id)
            setPersonalEntry(pEntry)
          }
          targetRepertoireId = pEntry.id
        }
      } else {
        isPersonal = true
      }

      const finalTitle = uploadTitle.trim() || uploadFile.name.replace(/\.[^/.]+$/, "")
      const formData = new FormData()
      formData.append('repertoireId', targetRepertoireId)
      formData.append('title', finalTitle)
      formData.append('file', uploadFile)

      const res = await uploadTabAction(formData)
      if (res.error) {
        setUploadError(res.error)
        return
      }
      if (res.data) {
        if (isPersonal) {
          setPersonalTabs(prev => [res.data!, ...prev])
        } else {
          setTabs(prev => [res.data!, ...prev])
        }
      }
      setUploadTitle('')
      setUploadFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload tab')
    } finally {
      setUploading(false)
      setShowUploadDestModal(false)
    }
  }

  // Handler for deleting tab
  async function handleDeleteTab(tabId: string, origin: 'band' | 'personal') {
    const targetId = origin === 'personal' && personalEntry ? personalEntry.id : entry?.id
    if (!targetId) return
    if (!confirm('Are you sure you want to delete this tab?')) return
    try {
      const res = await deleteTabAction(tabId, targetId)
      if (res.error) {
        alert(res.error)
      } else {
        if (origin === 'personal') {
          setPersonalTabs(prev => prev.filter(t => t.id !== tabId))
        } else {
          setTabs(prev => prev.filter(t => t.id !== tabId))
        }
      }
    } catch {
      alert('Failed to delete tab')
    }
  }

  // Handler for saving lyrics
  async function handleSaveLyrics() {
    if (!entry) return
    try {
      setSavingLyrics(true)
      
      let targetId = entry.id
      let targetBandId = entry.band_id

      if (entry.band_id && showPersonalLyrics) {
        let pEntry = personalEntry
        if (!pEntry) {
          pEntry = await addSongAction(entry.song_id)
          setPersonalEntry(pEntry)
        }
        targetId = pEntry.id
        targetBandId = null
      }

      await updateLyricsAction(targetId, lyricsText, targetBandId)

      if (entry.band_id && showPersonalLyrics) {
        setPersonalEntry(prev => prev ? { ...prev, lyrics: lyricsText } : null)
      } else {
        setEntry(prev => prev ? { ...prev, lyrics: lyricsText } : null)
      }
      setIsEditingLyrics(false)
    } catch {
      alert('Failed to save lyrics')
    } finally {
      setSavingLyrics(false)
    }
  }

  // Handler for auto-importing lyrics from Web API
  async function handleAutoImportLyrics() {
    if (!artist) {
      alert('Artist name is required to search for lyrics.')
      return
    }
    try {
      setFetchingLyrics(true)
      const lyrics = await fetchLyricsAction(artist, title)
      if (lyrics) {
        setLyricsText(lyrics)
      } else {
        alert(`Lyrics not found online for "${title}" by "${artist}". You can still paste them below.`)
      }
    } catch {
      alert('Failed to import lyrics from web. You can still paste them below.')
    } finally {
      setFetchingLyrics(false)
    }
  }

  // Handler for changing song status/mastery level
  async function handleStatusChange(newStatus: SongStatus) {
    if (!entry) return
    try {
      setUpdatingStatus(true)
      await updateSongStatusAction(entry.id, newStatus, entry.band_id)
      setEntry(prev => prev ? { ...prev, status: newStatus } : null)
      setIsStatusDropdownOpen(false)
    } catch {
      alert('Failed to update status')
    } finally {
      setUpdatingStatus(false)
    }
  }

  // Handler for adding a new song link
  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault()
    if (!entry || !entry.song) return
    
    const newLink: SongLink = {
      label: newLinkLabel.trim(),
      url: newLinkUrl.trim()
    }
    
    // Check for duplicate URLs
    const currentLinks = entry.song.links ?? []
    if (currentLinks.some(link => link.url === newLink.url)) {
      alert('This URL is already in the links list.')
      return
    }
    
    const updatedLinks = [...currentLinks, newLink]
    
    try {
      setSavingLink(true)
      await updateSongLinksAction(entry.id, updatedLinks)
      setEntry(prev => {
        if (!prev || !prev.song) return prev
        return {
          ...prev,
          song: {
            ...prev.song,
            links: updatedLinks
          }
        }
      })
      setIsAddingLink(false)
      setNewLinkLabel('')
      setNewLinkUrl('')
    } catch {
      alert('Failed to add link.')
    } finally {
      setSavingLink(false)
    }
  }

  // Handler for deleting a song link
  async function handleDeleteLink(urlToDelete: string) {
    if (!entry || !entry.song) return
    if (!confirm('Are you sure you want to delete this link?')) return
    
    const currentLinks = entry.song.links ?? []
    const updatedLinks = currentLinks.filter(link => link.url !== urlToDelete)
    
    try {
      await updateSongLinksAction(entry.id, updatedLinks)
      setEntry(prev => {
        if (!prev || !prev.song) return prev
        return {
          ...prev,
          song: {
            ...prev.song,
            links: updatedLinks
          }
        }
      })
    } catch {
      alert('Failed to delete link.')
    }
  }

  return (
    <>
      <main className="min-h-screen bg-gray-50 px-6 py-8 flex flex-col gap-6 max-w-xl mx-auto">
      {/* Back button */}
      <button
        type="button"
        onClick={() => {
          const params = new URLSearchParams(window.location.search)
          const returnTo = params.get('returnTo')
          if (returnTo) {
            router.push(returnTo)
          } else {
            router.back()
          }
        }}
        className="self-start text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
        aria-label="Back"
      >
        &larr; Back
      </button>

      {/* Song identity */}
      <section aria-label="Song details" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 leading-tight">{title}</h1>
            {artist && (
              <p className="mt-1 text-lg text-gray-500">{artist}</p>
            )}
          </div>
          <div className="relative shrink-0 mt-1">
            <button
              type="button"
              onClick={() => setIsStatusDropdownOpen(prev => !prev)}
              disabled={updatingStatus}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border hover:shadow-sm flex items-center gap-1.5 focus:outline-none ${cfg.bgColor} ${cfg.textColor} border-transparent hover:border-gray-300/40`}
            >
              <span>{cfg.label}</span>
              <span className="text-[10px] opacity-70" aria-hidden="true">&#9662;</span>
            </button>

            {isStatusDropdownOpen && (
              <>
                {/* Backdrop overlay to close when clicking outside */}
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setIsStatusDropdownOpen(false)}
                />
                
                {/* Floating Dropdown List */}
                <ul className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 z-30 flex flex-col gap-0.5 text-left">
                  {Object.entries(STATUS_CONFIG).map(([statusKey, statusCfg]) => {
                    const isSelected = entry?.status === statusKey
                    return (
                      <li key={statusKey}>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(statusKey as any)}
                          className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center justify-between transition-colors ${
                            isSelected ? 'text-emerald-700 bg-emerald-50/50' : 'text-gray-700'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            {/* Color Dot indicator */}
                            <span className={`w-2.5 h-2.5 rounded-full ${statusCfg.bgColor}`} />
                            <span>{statusCfg.label}</span>
                          </span>
                          {isSelected && (
                            <span className="text-emerald-600 font-bold">&#10003;</span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </div>

        {key && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">Key:</span> {key}
          </p>
        )}
      </section>

      {/* Tabs (PDF) Section */}
      <section aria-label="Tabs" className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Tabs (PDF)</h2>
        
        {/* Tab List */}
        {mergedTabs.length > 0 ? (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {mergedTabs.map((tab) => {
                const isActive = activeTabUrl === tab.file_url
                return (
                  <li
                    key={tab.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-emerald-50/60 border-emerald-300 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-emerald-100 shadow-sm'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isActive) {
                          setActiveTabUrl(null)
                          setActiveTabTitle('')
                        } else {
                          setActiveTabUrl(tab.file_url)
                          setActiveTabTitle(tab.title)
                        }
                      }}
                      className="flex flex-1 items-center gap-3 text-left text-gray-700 hover:text-emerald-600 font-medium transition-colors focus:outline-none min-w-0"
                    >
                      {/* PDF Icon */}
                      <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="truncate text-sm mr-1.5">{tab.title}</span>
                      
                      {/* Origin Badge */}
                      {tab.origin === 'band' ? (
                        <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-250 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 flex items-center gap-0.5" title="Shared with the whole band">
                          👥 Band
                        </span>
                      ) : (
                        <span className="text-[9px] font-semibold text-blue-700 bg-blue-50 border border-blue-250 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 flex items-center gap-0.5" title="Private study file">
                          👤 Personal
                        </span>
                      )}

                      {isActive && (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-105 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 ml-1">
                          Viewing
                        </span>
                      )}
                    </button>
                    
                    <div className="flex items-center gap-1 shrink-0">
                      {/* External Link Button */}
                      <a
                        href={tab.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-emerald-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                        title="Open in new tab / download"
                      >
                        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                      
                      {/* Delete Button */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isActive) {
                            setActiveTabUrl(null)
                            setActiveTabTitle('')
                          }
                          handleDeleteTab(tab.id, tab.origin)
                        }}
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                        aria-label="Delete tab"
                      >
                        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* Embedded PDF Viewer */}
            {activeTabUrl && (
              <div className="flex flex-col gap-2 bg-white border border-emerald-200 rounded-xl p-3 shadow-sm transition-all duration-300">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-gray-700 truncate max-w-[280px]">
                    Viewing: {activeTabTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTabUrl(null)
                      setActiveTabTitle('')
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Close viewer
                  </button>
                </div>
                <iframe
                  src={`https://docs.google.com/gview?url=${encodeURIComponent(activeTabUrl)}&embedded=true`}
                  className="w-full h-[550px] rounded-lg border border-gray-150"
                  title={activeTabTitle}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 bg-gray-100/60 border border-gray-200/50 rounded-xl p-4 text-center">No PDFs uploaded yet.</p>
        )}

        {/* Upload Form */}
        <form onSubmit={handleUploadClick} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-700">Upload New Tab</h3>

          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Tab Title (e.g. Guitar Solo, Bass)"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              disabled={uploading}
            />
            <input
              type="file"
              accept="application/pdf"
              ref={fileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0] || null
                setUploadFile(file)
                if (file && !uploadTitle.trim()) {
                  const defaultTitle = file.name.replace(/\.[^/.]+$/, "")
                  setUploadTitle(defaultTitle)
                }
              }}
              className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
              disabled={uploading}
            />
          </div>
          {uploadError && (
            <p className="text-xs text-red-600 font-medium">{uploadError}</p>
          )}
          <button
            type="submit"
            disabled={uploading || !uploadFile}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-100 disabled:text-gray-400 text-white font-medium text-sm rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5"
          >
            {uploading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Uploading...
              </>
            ) : (
              'Upload PDF'
            )}
          </button>
        </form>
      </section>

      {/* Links Section */}
      <section aria-label="Links" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Links</h2>
          {!isAddingLink && (
            <button
              type="button"
              onClick={() => setIsAddingLink(true)}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 transition-colors focus:outline-none"
            >
              + Add Link
            </button>
          )}
        </div>

        {links.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {links.map((link, idx) => (
              <li key={`${link.url}-${idx}`} className="group relative flex items-center justify-between">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center gap-3 px-5 py-4 rounded-xl bg-white border border-gray-200 shadow-sm text-emerald-600 font-medium hover:bg-emerald-50 hover:border-emerald-200 transition-colors pr-12"
                >
                  {getLinkIcon(link.url)}
                  <span className="truncate">{link.label || link.url}</span>
                  <span aria-hidden="true" className="text-lg ml-auto shrink-0">&#8599;</span>
                </a>
                
                {/* Delete link button */}
                <button
                  type="button"
                  onClick={() => handleDeleteLink(link.url)}
                  className="absolute right-12 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 z-10 mr-1"
                  aria-label="Delete link"
                >
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 bg-gray-100/60 border border-gray-200/50 rounded-xl p-4 text-center">No links added yet.</p>
        )}

        {/* Add Link Form */}
        {isAddingLink && (
          <form onSubmit={handleAddLink} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-700">Add New Link</h3>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Link Label (e.g. Chords, YouTube)"
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                required
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
              <input
                type="url"
                placeholder="Link URL (https://...)"
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                required
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsAddingLink(false)
                  setNewLinkLabel('')
                  setNewLinkUrl('')
                }}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingLink}
                className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {savingLink ? 'Saving...' : 'Add'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Lyrics Section */}
      <section aria-label="Lyrics" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Lyrics</h2>
            {entry.band_id && (
              showPersonalLyrics ? (
                <span className="text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                  👤 Pessoal
                </span>
              ) : (
                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-250 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                  👥 Banda
                </span>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            {displayedLyrics && !isEditingLyrics && (
              <button
                type="button"
                onClick={() => setIsStageMode(true)}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 transition-colors flex items-center gap-1 focus:outline-none"
              >
                <span>🔍 Stage Mode</span>
              </button>
            )}
            {!isEditingLyrics && (
              <button
                type="button"
                onClick={() => {
                  setLyricsText(displayedLyrics ?? '')
                  setIsEditingLyrics(true)
                }}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 transition-colors focus:outline-none"
              >
                {displayedLyrics ? 'Edit' : 'Add'}
              </button>
            )}
          </div>
        </div>

        {/* Lyrics version switcher banner (only in band mode if personal differs) */}
        {hasDifferentPersonalLyrics && !isEditingLyrics && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 shadow-sm text-xs text-blue-700">
            <span className="font-medium">💡 Você tem uma versão pessoal diferente para esta música.</span>
            <button
              type="button"
              onClick={() => setShowPersonalLyrics(!showPersonalLyrics)}
              className="font-bold underline hover:text-blue-900 transition-colors focus:outline-none shrink-0"
            >
              {showPersonalLyrics ? 'Ver letra da Banda (👥)' : 'Ver minha letra (👤)'}
            </button>
          </div>
        )}

        {isEditingLyrics ? (
          <div className="flex flex-col gap-3">
            <textarea
              className="w-full min-h-[250px] p-4 rounded-xl border border-gray-200 shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm font-sans resize-y leading-relaxed text-gray-800"
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
              placeholder="Paste or type the lyrics here..."
              disabled={savingLyrics}
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleAutoImportLyrics}
                disabled={fetchingLyrics || savingLyrics}
                className="px-3 py-1.5 border border-emerald-200 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-50 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
              >
                {fetchingLyrics ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Importing...
                  </>
                ) : (
                  <>
                    <span>✨ Auto-import</span>
                  </>
                )}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLyricsText(displayedLyrics ?? '')
                    setIsEditingLyrics(false)
                  }}
                  disabled={savingLyrics}
                  className="px-3 py-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveLyrics}
                  disabled={savingLyrics}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-100 disabled:text-gray-400 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                >
                  {savingLyrics ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            {displayedLyrics ? (
              <div className="text-gray-800 text-sm font-sans leading-relaxed select-text flex flex-col gap-1.5">
                {displayedLyrics.split('\n').map((line, idx) => (
                  <div
                    key={idx}
                    className="min-h-[1.2rem] whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: parseLyricsMarkdown(line) }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-2">No lyrics added yet.</p>
            )}
          </div>
        )}
      </section>

      {/* Tags Section */}
      {entry.tags.length > 0 && (
        <section aria-label="Tags">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Tags</h2>
          <ul className="flex flex-wrap gap-2">
            {entry.tags.map((tag) => (
              <li
                key={tag}
                className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm"
              >
                {tag}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>

    {/* Stage Mode (Full Screen Lyrics) */}
    {isStageMode && displayedLyrics && (
      <div
        className={`fixed inset-0 z-50 overflow-y-auto px-6 py-8 flex flex-col gap-6 transition-colors duration-300 ${
          isStageDarkMode ? 'bg-gray-950 text-gray-100' : 'bg-white text-gray-900'
        }`}
        style={{ fontSize: `${lyricsFontSize}px` }}
      >
        {/* Header Controls */}
        <div className="sticky top-0 z-10 py-3 flex items-center justify-between border-b backdrop-blur-md bg-opacity-70 pr-2 border-gray-200/20">
          <div className="flex flex-col min-w-0">
            <h2 className={`text-lg font-bold truncate ${isStageDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              {title}
            </h2>
            {key && (
              <span className="text-xs opacity-75">Tom: {key}</span>
            )}
          </div>
          
          {/* Control Panel */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Dark Mode Toggle */}
            <button
              type="button"
              onClick={() => setIsStageDarkMode(prev => !prev)}
              className={`p-2 rounded-lg text-xs font-semibold transition-colors focus:outline-none ${
                isStageDarkMode 
                  ? 'bg-gray-800 text-yellow-400 hover:bg-gray-700' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Alternar Modo Escuro"
            >
              {isStageDarkMode ? '☀️ Claro' : '🌙 Escuro'}
            </button>
            
            {/* Font Size decrease */}
            <button
              type="button"
              onClick={() => setLyricsFontSize(prev => Math.max(12, prev - 2))}
              className={`w-8 h-8 rounded-lg text-sm font-bold flex items-center justify-center transition-colors focus:outline-none ${
                isStageDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'
              }`}
              title="Diminuir Fonte"
            >
              A-
            </button>
            
            {/* Font Size increase */}
            <button
              type="button"
              onClick={() => setLyricsFontSize(prev => Math.min(36, prev + 2))}
              className={`w-8 h-8 rounded-lg text-sm font-bold flex items-center justify-center transition-colors focus:outline-none ${
                isStageDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'
              }`}
              title="Aumentar Fonte"
            >
              A+
            </button>
            
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setIsStageMode(false)}
              className="ml-2 w-9 h-9 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center transition-colors focus:outline-none shadow-sm"
              title="Fechar Modo Palco"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* Scrollable Lyrics Container */}
        <div className="flex-1 max-w-xl mx-auto w-full py-4 select-text">
          <div className="flex flex-col gap-2 font-mono leading-relaxed tracking-wide">
            {displayedLyrics.split('\n').map((line, idx) => (
              <div
                key={idx}
                className="min-h-[1.5rem] whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: parseLyricsMarkdown(line) }}
              />
            ))}
          </div>
        </div>
      </div>
    )}

    {/* Upload Destination Choice Modal (Only in band mode) */}
    {showUploadDestModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl border border-gray-150 shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
          <div>
            <h3 className="text-base font-bold text-gray-900">Upload Destination</h3>
            <p className="text-xs text-gray-500 mt-1">Where would you like to save this PDF?</p>
          </div>
          
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => triggerUpload('personal')}
              disabled={uploading}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/20 text-left transition-all group focus:outline-none"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-700 transition-colors">👤 Personal studies</span>
                <span className="text-[10px] text-gray-400">Private only to you</span>
              </div>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">Private</span>
            </button>
            
            <button
              type="button"
              onClick={() => triggerUpload('band')}
              disabled={uploading}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/20 text-left transition-all group focus:outline-none"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-800 group-hover:text-emerald-700 transition-colors">👥 Band files</span>
                <span className="text-[10px] text-gray-400">Shared with all members</span>
              </div>
              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">Shared</span>
            </button>
          </div>
          
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setShowUploadDestModal(false)}
              disabled={uploading}
              className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-xs font-semibold rounded-lg text-gray-600 transition-colors focus:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

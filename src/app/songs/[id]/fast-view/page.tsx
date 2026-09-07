'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import type { Repertoire, SongStatus, SongLink } from '@/types/database'
import { STATUS_CONFIG } from '@/lib/statusConfig'
import { logger } from '@/lib/logger'
import { getSongEntryAction as getSongEntry, updateSongStatusAction, updateSongLinksAction, getPersonalEntryForSongAction, fetchUrlTitleAction } from '@/app/actions/repertoire'
import { ConfirmPanel } from '@/components/ui/ConfirmPanel'
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/hooks/useToast'
import { slideOutClassName } from '@/lib/playlistNav'
import { usePlaylistNav } from '@/hooks/usePlaylistNav'
import { PLAYLIST_NAV_ACTIONS } from '@/app/fastViewNavActions'
import { SetlistDrawer } from '@/components/fastview/SetlistDrawer'
import { SetlistSidebar } from '@/components/fastview/SetlistSidebar'
import { SetlistSelect } from '@/components/fastview/SetlistSelect'
import { SetlistPill } from '@/components/fastview/SetlistPill'
import { PlaylistPrevArrow } from '@/components/fastview/PlaylistPrevArrow'
import { SwipeHint } from '@/components/fastview/SwipeHint'
import { useTabLibrary } from '@/hooks/useTabLibrary'
import { usePdfStage } from '@/hooks/usePdfStage'
import { PDF_STAGE_ACTIONS, TAB_LIBRARY_ACTIONS } from '@/app/fastViewTabActions'
import { TabLibrarySection } from '@/components/fastview/TabLibrarySection'
import { TabDestinationModal } from '@/components/fastview/TabDestinationModal'
import { TabDeleteConfirm } from '@/components/fastview/TabDeleteConfirm'
import { PdfStageOverlay } from '@/components/fastview/PdfStageOverlay'
import { useLyricsEditor } from '@/hooks/useLyricsEditor'
import { LYRICS_EDITOR_ACTIONS } from '@/app/fastViewLyricsActions'
import { LyricsSection } from '@/components/fastview/LyricsSection'
import { LyricsStageOverlay } from '@/components/fastview/LyricsStageOverlay'

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

/**
 * The tab-library inputs the two entry states supply. Read through a helper so
 * the page component itself carries no extra branches for state that is null
 * until the entry (and, in a band, the member's own entry) has loaded.
 */
function tabLibraryEntryInputs(entry: Repertoire | null, personalEntry: Repertoire | null) {
  return {
    entryBandId: entry?.band_id ?? null,
    songId: entry?.song_id ?? null,
    personalRepertoireId: personalEntry?.id ?? null,
  }
}

/** A destructive delete awaiting in-page confirmation. */
type PendingDelete = { kind: 'link'; url: string }

export default function FastViewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const queryBandId = searchParams.get('bandId')

  const [entry, setEntry] = useState<Repertoire | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Status changing state
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Toast notification state
  const { toast, showToast, dismissToast } = useToast()

  // Links editing state
  const [isAddingLink, setIsAddingLink] = useState(false)
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')
  const [savingLink, setSavingLink] = useState(false)

  // Band vs Personal aggregation states
  const [personalEntry, setPersonalEntry] = useState<Repertoire | null>(null)
  const [loadingPersonal, setLoadingPersonal] = useState(false)

  // Tab library: the two tab fetches, the active tab, the upload with its
  // destination choice and the tab delete confirmation live in this controller
  // (RH-49). PDF Stage Mode still reads the active tab from it.
  const tabLibrary = useTabLibrary({
    repertoireId: id,
    ...tabLibraryEntryInputs(entry, personalEntry),
    actions: TAB_LIBRARY_ACTIONS,
    onPersonalEntryCreated: setPersonalEntry,
    notify: showToast,
    onDeleteRequested: () => setPendingDelete(null),
  })
  const { activeTabId, activeTabRepertoireId, activeTabUrl, activeTabTitle } = tabLibrary

  // PDF Stage Mode: the overlay's open state, its visual-viewport measurement,
  // the scroll-host lock, the back-button intercept and the annotation
  // load/save live in this controller (RH-50).
  const pdfStage = usePdfStage({
    tabId: activeTabId,
    repertoireId: activeTabRepertoireId,
    actions: PDF_STAGE_ACTIONS,
  })

  // Playlist navigation: the setlist fetch, the drawer, the slide-out and every
  // router push the setlist UI can trigger live in this controller (RH-48).
  const playlist = usePlaylistNav({
    currentRepertoireId: id,
    returnTo,
    bandId: queryBandId,
    actions: PLAYLIST_NAV_ACTIONS,
    navigate: (href) => router.push(href),
    navigateBack: () => router.back(),
  })

  // Lyrics: the edit draft with its save and online auto-import, the band vs
  // personal version switch and the lyrics Stage Mode (its font size, its dark
  // mode and its back-button intercept) live in this controller (RH-51).
  const lyrics = useLyricsEditor({
    entry,
    personalEntry,
    songTitle: entry?.song?.title ?? '(untitled)',
    artist: entry?.song?.artist ?? '',
    actions: LYRICS_EDITOR_ACTIONS,
    onEntryLyricsSaved: (saved) => setEntry(prev => prev ? { ...prev, lyrics: saved } : null),
    onPersonalLyricsSaved: (saved) => setPersonalEntry(prev => prev ? { ...prev, lyrics: saved } : null),
    onPersonalEntryCreated: setPersonalEntry,
    notify: showToast,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await getSongEntry(id, queryBandId)

        if (!cancelled) {
          if (!data) {
            setNotFound(true)
          } else {
            setEntry(data)

            // If we are in band context, fetch the personal entry in background
            if (queryBandId && data.song_id) {
              setLoadingPersonal(true)
              getPersonalEntryForSongAction(data.song_id).then((pEntry) => {
                if (pEntry && !cancelled) {
                  setPersonalEntry(pEntry)
                }
              }).catch((e) => {
                logger.error('Failed to load personal entry', e instanceof Error ? e : new Error(String(e)))
              }).finally(() => {
                if (!cancelled) setLoadingPersonal(false)
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
  }, [id, queryBandId])

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

  // Handler for changing song status/mastery level
  async function handleStatusChange(newStatus: SongStatus) {
    if (!entry) return
    try {
      setUpdatingStatus(true)
      await updateSongStatusAction(entry.id, newStatus, entry.band_id)
      setEntry(prev => prev ? { ...prev, status: newStatus } : null)
      setIsStatusDropdownOpen(false)
      showToast(`Status updated to ${STATUS_CONFIG[newStatus]?.label ?? newStatus}`, 'success')
    } catch {
      showToast('Failed to update status', 'error')
    } finally {
      setUpdatingStatus(false)
    }
  }

  // Handler for adding a new song link
  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault()
    if (!entry || !entry.song) return
    
    // Check for duplicate URLs
    const currentLinks = entry.song.links ?? []
    if (currentLinks.some(link => link.url === newLinkUrl.trim())) {
      showToast('This URL is already in the links list.', 'warning')
      return
    }

    try {
      setSavingLink(true)

      let finalLabel = newLinkLabel.trim()
      if (!finalLabel) {
        finalLabel = await fetchUrlTitleAction(newLinkUrl.trim())
      }

      const newLink: SongLink = {
        label: finalLabel || newLinkUrl.trim(),
        url: newLinkUrl.trim()
      }

      const updatedLinks = [...currentLinks, newLink]
      
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
      showToast('Link added successfully!', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add link.', 'error')
    } finally {
      setSavingLink(false)
    }
  }

  // Handler for deleting a song link — opens the in-page confirmation
  function handleDeleteLink(urlToDelete: string) {
    if (!entry || !entry.song) return
    // Mirror of the hook's `onDeleteRequested`: never two confirmations at once.
    tabLibrary.cancelDelete()
    setPendingDelete({ kind: 'link', url: urlToDelete })
  }

  // Runs the delete that the in-page confirmation is holding
  async function confirmPendingDelete() {
    if (!pendingDelete) return
    setDeleteBusy(true)
    try {
      if (entry?.song) {
        const currentLinks = entry.song.links ?? []
        const updatedLinks = currentLinks.filter(link => link.url !== pendingDelete.url)

        try {
          // Removing a link rewrites the shared catalog for everyone, so it is
          // submitted for review instead of applied: keep the link on screen
          // until an admin approves the removal.
          const result = await updateSongLinksAction(entry.id, updatedLinks)
          if (result.pending) {
            showToast('Link removal submitted for review. It stays visible until an admin approves it.', 'warning')
          } else {
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
            showToast('Link deleted.', 'info')
          }
        } catch {
          showToast('Failed to delete link.', 'error')
        }
      }
      setPendingDelete(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <>
      {/* Mobile Setlist Bottom Sheet Modal */}
      <SetlistDrawer
        open={playlist.isDrawerOpen}
        nav={playlist.nav}
        entries={playlist.entries}
        currentRepertoireId={id}
        onClose={playlist.closeDrawer}
        onSelect={playlist.selectEntry}
      />

      {/* Desktop: Side Arrow Navigation Button (previous only, by design) */}
      <PlaylistPrevArrow prevId={playlist.nav?.prevId ?? null} onNavigate={playlist.goPrev} />

      {/* Two-Column Desktop / One-Column Mobile Layout */}
      <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">
        <div className="flex-1 overflow-x-hidden min-w-0">
          <main
            className={slideOutClassName(playlist.slideOut)}
            onTouchStart={(e) => playlist.onTouchStart(e.touches[0].clientX)}
            onTouchEnd={(e) => playlist.onTouchEnd(e.changedTouches[0].clientX)}
          >
            {/* Back button + mobile setlist trigger pill */}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={playlist.goBack}
                className="text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
                aria-label="Back"
              >
                &larr; Back
              </button>

              <SetlistPill nav={playlist.nav} onOpen={playlist.openDrawer} />
            </div>

      {/* Mobile / Tablet Select dropdown for fast playlist navigation */}
      <SetlistSelect
        nav={playlist.nav}
        entries={playlist.entries}
        currentRepertoireId={id}
        onSelect={playlist.selectEntry}
      />

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
      <TabLibrarySection
        library={tabLibrary}
        loadingPersonal={loadingPersonal}
        onOpenStage={pdfStage.open}
      />

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
              <li key={`${link.url}-${idx}`}>
                <div className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl bg-white border border-gray-200 shadow-sm hover:border-emerald-200 transition-colors">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-between gap-3 text-emerald-600 font-medium hover:underline min-w-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {getLinkIcon(link.url)}
                      <span className="truncate text-sm font-medium">{link.label || link.url}</span>
                    </div>
                    {/* External link icon (square with arrow out - matching PDF tabs) */}
                    <svg className="w-4 h-4 text-emerald-500 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  
                  <div className="h-4 w-px bg-gray-200 shrink-0" aria-hidden="true" />

                  {/* Delete link button - inside card on the right */}
                  <button
                    type="button"
                    onClick={() => handleDeleteLink(link.url)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                    aria-label="Delete link"
                    title="Delete link"
                  >
                    <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
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
                placeholder="Link Label (optional - auto-fetched if blank)"
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                className="px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
              <input
                type="url"
                placeholder="Link URL (https://...)"
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                required
                className="px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
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
      <LyricsSection controller={lyrics} loadingPersonal={loadingPersonal} />

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
      {/* Mobile / Tablet: Swipe hint strip (only when in a playlist) */}
      <SwipeHint nav={playlist.nav} />
      </main>
    </div>

    {/* Dedicated Right Setlist Sidebar on Desktop (`lg:flex`) */}
    <SetlistSidebar
      nav={playlist.nav}
      entries={playlist.entries}
      currentRepertoireId={id}
      onSelect={playlist.selectEntry}
    />
  </div>
    {/* Stage Mode (Full Screen Lyrics) */}
    <LyricsStageOverlay controller={lyrics} songTitle={title} songKey={key} />

    {/* PDF Stage Mode Overlay */}
    <PdfStageOverlay
      open={pdfStage.isOpen}
      overlayRef={pdfStage.overlayRef}
      height={pdfStage.height}
      tabId={activeTabId}
      fileUrl={activeTabUrl}
      tabTitle={activeTabTitle}
      songTitle={title}
      songKey={key}
      annotations={pdfStage.annotations}
      annotationsError={pdfStage.annotationsError}
      onSaveAnnotations={pdfStage.saveAnnotations}
      onClose={pdfStage.close}
    />

    {/* Upload Destination Choice Modal (Only in band mode) */}
    <TabDestinationModal
      open={tabLibrary.isDestinationModalOpen}
      uploading={tabLibrary.uploading}
      onChoose={tabLibrary.chooseDestination}
      onCancel={tabLibrary.cancelDestination}
    />

    {/* Tab delete confirmation — same anchor as the link one below */}
    <TabDeleteConfirm
      pending={tabLibrary.pendingDelete !== null}
      busy={tabLibrary.deleteBusy}
      onConfirm={tabLibrary.confirmDelete}
      onCancel={tabLibrary.cancelDelete}
    />

    {/* In-page delete confirmation — anchored above the Toast so they never overlap */}
    {pendingDelete && (
      <ConfirmPanel
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm shadow-xl"
        message="Delete this link? This can't be undone."
        confirmLabel="Delete"
        busy={deleteBusy}
        onConfirm={confirmPendingDelete}
        onCancel={() => setPendingDelete(null)}
      />
    )}

    {/* Floating Toast Notification */}
    {toast && (
      <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />
    )}
    </>
  )
}

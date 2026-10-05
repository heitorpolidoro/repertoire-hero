'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/hooks/useToast'
import { useOfflineStatus } from '@/hooks/useOfflineStatus'
import { useWakeLock } from '@/hooks/useWakeLock'
// The seven bundles, offline-first. Imported from the one composition root that
// wraps them (RH-80) instead of from the four `fastView*Actions.ts` files,
// which are unchanged and keep their other consumers.
import {
  OFFLINE_FIRST_LYRICS_EDITOR_ACTIONS,
  OFFLINE_FIRST_PDF_STAGE_ACTIONS,
  OFFLINE_FIRST_PLAYLIST_NAV_ACTIONS,
  OFFLINE_FIRST_SONG_ENTRY_ACTIONS,
  OFFLINE_FIRST_SONG_LINKS_ACTIONS,
  OFFLINE_FIRST_SONG_STATUS_ACTIONS,
  OFFLINE_FIRST_TAB_LIBRARY_ACTIONS,
} from '@/app/fastViewOfflineActions'
import { slideOutClassName } from '@/lib/playlistNav'
import { usePlaylistNav } from '@/hooks/usePlaylistNav'
import { SetlistDrawer } from '@/components/fastview/SetlistDrawer'
import { SetlistSidebar } from '@/components/fastview/SetlistSidebar'
import { SetlistSelect } from '@/components/fastview/SetlistSelect'
import { SetlistPill } from '@/components/fastview/SetlistPill'
import { PlaylistPrevArrow } from '@/components/fastview/PlaylistPrevArrow'
import { SwipeHint } from '@/components/fastview/SwipeHint'
import { useTabLibrary } from '@/hooks/useTabLibrary'
import { usePdfStage } from '@/hooks/usePdfStage'
import { TabLibrarySection } from '@/components/fastview/TabLibrarySection'
import { useLyricsEditor } from '@/hooks/useLyricsEditor'
import { LyricsSection } from '@/components/fastview/LyricsSection'
import { useSongEntry } from '@/hooks/useSongEntry'
import { useSongStatus } from '@/hooks/useSongStatus'
import { useSongLinks } from '@/hooks/useSongLinks'
import { SongIdentityHeader } from '@/components/fastview/SongIdentityHeader'
import { LinksSection } from '@/components/fastview/LinksSection'
import { SongTagsSection } from '@/components/fastview/SongTagsSection'
import { SongLoading, SongNotFound } from '@/components/fastview/SongLoadStates'
import { OfflineBanner } from '@/components/fastview/OfflineBanner'
import { OfflineUnavailable } from '@/components/fastview/OfflineUnavailable'
import { FastViewOverlays } from '@/components/fastview/FastViewOverlays'

/**
 * Fast View — the stripped-down reading page a musician props on a music stand.
 *
 * A composition root: it reads the route, wires the seven controllers to each
 * other and to their Server Action bundles, and lays the sections out. Every
 * decision, every effect and every write lives in `src/hooks` (state) and
 * `src/lib` (pure logic), and every pixel in `src/components/fastview`
 * (RH-38, closed by RH-52).
 *
 * RH-80 added one signal to that wiring: `useOfflineStatus()`, read exactly
 * once here. Every offline decision on this page is a prop derived from it — a
 * banner, `readOnly` on every write control the page can reach, `offline` on
 * the tab card and the "not downloaded" empty state — so
 * `src/components/fastview/**` stays presentational and no component reads
 * `navigator.onLine` itself. RH-99 widened `readOnly` from the two RH-80 edit
 * controls to every one of them: offline is read-only *by intent*, so a write
 * control is disabled rather than left to fail. The *data*
 * side is independent of the signal: the bundles imported above are already
 * offline-first, so they answer from the RH-79 snapshot on their own.
 */
export default function FastViewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const queryBandId = searchParams.get('bandId')

  // One Toast for the whole page (every controller reports through it) and the
  // page's single offline reader — see the note above the component.
  const { toast, showToast, dismissToast } = useToast()
  const isOffline = useOfflineStatus()
  useWakeLock() // the screen stays on while a song is open on a music stand

  // The route's entry, the band-context reconciliation of the member's own
  // entry and the five patches the writes below apply (RH-52).
  const song = useSongEntry({ repertoireId: id, bandId: queryBandId, actions: OFFLINE_FIRST_SONG_ENTRY_ACTIONS })
  const { entry, personalEntry, identity } = song

  // The mastery-status dropdown and its write (RH-52).
  const status = useSongStatus({
    entry,
    actions: OFFLINE_FIRST_SONG_STATUS_ACTIONS,
    onStatusSaved: song.applyStatus,
    notify: showToast,
  })

  // The links section: the add form with its auto-filled label and the delete
  // that goes through the shared-catalog moderation queue (RH-52). Declared
  // before `useTabLibrary`, which closes this confirmation when its own opens.
  const links = useSongLinks({
    entry,
    actions: OFFLINE_FIRST_SONG_LINKS_ACTIONS,
    onLinksSaved: song.applyLinks,
    notify: showToast,
  })

  // File library: the song's one file fetch, the active file, the upload and
  // the delete confirmation live in this controller (RH-49). A file is keyed by
  // `(user_id, song_id)` since RH-123, so the song id is the whole of what this
  // hook needs. PDF Stage Mode still reads the active file from it.
  const tabLibrary = useTabLibrary({
    songId: song.songId,
    actions: OFFLINE_FIRST_TAB_LIBRARY_ACTIONS,
    onPersonalEntryCreated: song.adoptPersonalEntry,
    notify: showToast,
    onDeleteRequested: links.cancelDelete,
  })

  // PDF Stage Mode: the overlay's open state, its visual-viewport measurement,
  // the scroll-host lock, the back-button intercept and the annotation
  // load/save live in this controller (RH-50).
  const pdfStage = usePdfStage({
    tabId: tabLibrary.activeTabId,
    actions: OFFLINE_FIRST_PDF_STAGE_ACTIONS,
  })

  // Lyrics: the edit draft with its save and online auto-import, the band vs
  // personal version switch and the lyrics Stage Mode (its font size, its dark
  // mode and its back-button intercept) live in this controller (RH-51).
  const lyrics = useLyricsEditor({
    entry,
    personalEntry,
    songTitle: identity.title,
    artist: identity.artist,
    actions: OFFLINE_FIRST_LYRICS_EDITOR_ACTIONS,
    onEntryLyricsSaved: song.applyEntryLyrics,
    onPersonalLyricsSaved: song.applyPersonalLyrics,
    onPersonalEntryCreated: song.adoptPersonalEntry,
    notify: showToast,
  })

  // Playlist navigation: the setlist fetch, the drawer, the slide-out and every
  // router push the setlist UI can trigger live in this controller (RH-48).
  // The arrow keys stay off while either Stage Mode surface is up.
  const playlist = usePlaylistNav({
    currentRepertoireId: id,
    returnTo,
    bandId: queryBandId,
    actions: OFFLINE_FIRST_PLAYLIST_NAV_ACTIONS,
    navigate: (href) => router.push(href),
    navigateBack: () => router.back(),
    keyboardEnabled: !pdfStage.isOpen && !lyrics.isStageOpen,
  })

  if (song.loading) return <SongLoading />
  // Offline, "not found" is almost always "not downloaded": the snapshot reader
  // answers `null` for a song in no downloaded playlist, and "Song not found"
  // would send the musician looking for the wrong problem.
  if (song.notFound || !entry) {
    const goBack = () => router.back()
    return isOffline ? <OfflineUnavailable onBack={goBack} /> : <SongNotFound onBack={goBack} />
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
            {/* Read-only notice, offline only */}
            {isOffline && <OfflineBanner />}

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
            <SongIdentityHeader identity={identity} status={status} readOnly={isOffline} />

            {/* Tabs (PDF) Section */}
            <TabLibrarySection
              library={tabLibrary}
              loadingPersonal={song.loadingPersonal}
              onOpenStage={pdfStage.open}
              offline={isOffline}
              readOnly={isOffline}
            />

            {/* Links Section — `onDelete`'s wiring is documented on the prop */}
            <LinksSection
              controller={links}
              onDelete={(url) => {
                tabLibrary.cancelDelete()
                links.requestDelete(url)
              }}
              readOnly={isOffline}
            />

            {/* Lyrics Section */}
            <LyricsSection controller={lyrics} loadingPersonal={song.loadingPersonal} readOnly={isOffline} />

            {/* Tags Section */}
            <SongTagsSection tags={entry.tags} />

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

      {/* Stage Mode surfaces, the two confirmations and the floating Toast */}
      <FastViewOverlays
        identity={identity}
        lyrics={lyrics}
        pdfStage={pdfStage}
        tabLibrary={tabLibrary}
        links={links}
        toast={toast}
        onDismissToast={dismissToast}
        readOnly={isOffline}
      />
    </>
  )
}

'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/hooks/useToast'
import { useOfflineStatus } from '@/hooks/useOfflineStatus'
import { useWakeLock } from '@/hooks/useWakeLock'
// The six bundles, offline-first. Imported from the one composition root that
// wraps them (RH-80) instead of from the three `fastView*Actions.ts` files,
// which are unchanged and keep their other consumers. The setlist needs none:
// RH-133 made it a `sessionStorage` queue the controller reads locally.
import {
  AUDIO_LIBRARY_ACTIONS,
  OFFLINE_FIRST_LYRICS_EDITOR_ACTIONS,
  OFFLINE_FIRST_PDF_STAGE_ACTIONS,
  OFFLINE_FIRST_SONG_ENTRY_ACTIONS,
  OFFLINE_FIRST_SONG_LINKS_ACTIONS,
  OFFLINE_FIRST_SONG_STATUS_ACTIONS,
  OFFLINE_FIRST_SONG_TUNING_ACTIONS,
  OFFLINE_FIRST_SONG_MAP_ACTIONS,
  OFFLINE_FIRST_SONG_WINDOW_ACTIONS,
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
import { AudioLibrarySection } from '@/components/fastview/AudioLibrarySection'
import { useLyricsEditor } from '@/hooks/useLyricsEditor'
import { LyricsSection } from '@/components/fastview/LyricsSection'
import { useSongEntry } from '@/hooks/useSongEntry'
import { useSongWindow } from '@/hooks/useSongWindow'
import { useSongStatus } from '@/hooks/useSongStatus'
import { useSongTuning } from '@/hooks/useSongTuning'
import { useSongMap } from '@/hooks/useSongMap'
import { SongMapSection } from '@/components/fastview/SongMapSection'
import { useSongLinks } from '@/hooks/useSongLinks'
import { SongIdentityHeader } from '@/components/fastview/SongIdentityHeader'
import { SpotifyPlayer } from '@/components/fastview/SpotifyPlayer'
import { YoutubeEmbed } from '@/components/fastview/YoutubeEmbed'
import { LinksSection } from '@/components/fastview/LinksSection'
import { SongTagsSection } from '@/components/fastview/SongTagsSection'
import { SongLoading, SongNotFound } from '@/components/fastview/SongLoadStates'
// RH-116: the per-song offline control gets the raw actions, not the offline-first
// wrappers, since a download is disabled while offline.
import { OFFLINE_DOWNLOAD_ACTIONS } from '@/app/offlineActions'
import { OfflineSongButton } from '@/components/fastview/OfflineSongButton'
import { OfflineBanner } from '@/components/fastview/OfflineBanner'
import { OfflineUnavailable } from '@/components/fastview/OfflineUnavailable'
import { FastViewOverlays } from '@/components/fastview/FastViewOverlays'
import { PRACTICE_FINISH_ACTIONS } from '@/app/fastViewPracticeActions'
import { usePracticeFinish } from '@/hooks/usePracticeFinish'
import { PracticeFinishButton } from '@/components/fastview/PracticeFinishButton'
import { PracticeReviewList } from '@/components/ui/PracticeReviewList'

/**
 * Fast View — the stripped-down reading page a musician props on a music stand.
 *
 * A composition root: it reads the route, wires the seven controllers to each
 * other and to their Server Action bundles, and lays the sections out.
 *
 * `queryBandId` is the page's **only** owner value, and it comes from
 * `searchParams` alone: it is what every write below is given, so no
 * client-writable source can become a write argument. The setlist controller
 * resolves its own href parameter from the tab's queue (RH-133); the page does
 * not read the queue and does not import it. Every
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
 *
 * RH-132 changed what the route *is*: the param is a `song_versions.id` and the
 * owner comes from `?bandId=`, so a version the owner holds no row for is a
 * page that renders at version defaults — title, artist, inherited
 * key/tuning/lyrics/map, empty tags, status `unknown`, the file library.
 * `song.ownerRowId` is then `null`, and it joins `isOffline` as the **second
 * reason** the page is read-only: both mean "readable, not writable", and both
 * disable the same five write controls through the one `readOnly` expression
 * below. Nothing may be created from here either — creating an owner row from
 * Fast View is deliberately out of scope — so the refusal lives behind each
 * disabled control as a guard in its hook, not as a silent no-op (§3c).
 */
export default function FastViewPage() {
  const { versionId } = useParams<{ versionId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryBandId = searchParams.get('bandId')

  // The page's one Toast and its single offline reader — see the docblock.
  const { toast, showToast, dismissToast } = useToast()
  const isOffline = useOfflineStatus()
  useWakeLock() // the screen stays on while a song is open on a music stand

  // The window (RH-134), first; `afterWrite` is the one invalidation seam every write goes through.
  const { afterWrite, invalidateCurrent } = useSongWindow({ versionId, bandId: queryBandId, actions: OFFLINE_FIRST_SONG_WINDOW_ACTIONS })

  // The route's entry, member-entry reconciliation and write patches (RH-52).
  const song = useSongEntry({ versionId, bandId: queryBandId, actions: OFFLINE_FIRST_SONG_ENTRY_ACTIONS })
  const { entry, personalEntry, identity } = song
  const readOnly = isOffline || !song.ownerRowId // the two reasons: see the docblock
  // Status dropdown (RH-52), tuning line (RH-146) and Map section (RH-118), each with its write.
  const status = useSongStatus({ entry, bandId: queryBandId, actions: OFFLINE_FIRST_SONG_STATUS_ACTIONS, onStatusSaved: afterWrite(song.applyStatus), notify: showToast })
  const tuning = useSongTuning({ entry, bandId: queryBandId, actions: OFFLINE_FIRST_SONG_TUNING_ACTIONS, onSaved: afterWrite(song.applyTuning), notify: showToast })
  const songMap = useSongMap({ entry, bandId: queryBandId, actions: OFFLINE_FIRST_SONG_MAP_ACTIONS, onSaved: afterWrite(song.applyMap), notify: showToast })
  // Links section (RH-52); declared before `useTabLibrary`, which closes its delete confirmation.
  const links = useSongLinks({
    entry,
    actions: OFFLINE_FIRST_SONG_LINKS_ACTIONS,
    onLinksSaved: afterWrite(song.applyLinks),
    notify: showToast,
  })

  // File library (RH-49), keyed by song id since RH-123.
  const tabLibrary = useTabLibrary({
    songId: song.songId,
    actions: OFFLINE_FIRST_TAB_LIBRARY_ACTIONS,
    onPersonalEntryCreated: song.adoptPersonalEntry,
    notify: showToast,
    onDeleteRequested: links.cancelDelete,
    versionId,
    bandId: queryBandId,
    onFilesChanged: invalidateCurrent,
  })

  // PDF Stage Mode: viewport, scroll lock, back intercept, annotations (RH-50).
  const pdfStage = usePdfStage({ tabId: tabLibrary.activeTabId, actions: OFFLINE_FIRST_PDF_STAGE_ACTIONS })

  // Lyrics: draft, save, band/personal switch and lyrics Stage Mode (RH-51).
  const lyrics = useLyricsEditor({
    entry,
    bandId: queryBandId,
    personalEntry,
    songTitle: identity.title,
    artist: identity.artist,
    actions: OFFLINE_FIRST_LYRICS_EDITOR_ACTIONS,
    onEntryLyricsSaved: afterWrite(song.applyEntryLyrics),
    onPersonalLyricsSaved: afterWrite(song.applyPersonalLyrics),
    onPersonalEntryCreated: song.adoptPersonalEntry,
    notify: showToast,
  })

  // Setlist navigation over the tab's song queue (RH-48, RH-133); arrows off during Stage Mode.
  const playlist = usePlaylistNav({
    currentVersionId: versionId,
    bandId: queryBandId,
    navigate: (href) => router.push(href),
    navigateBack: () => router.back(),
    keyboardEnabled: !pdfStage.isOpen && !lyrics.isStageOpen,
  })

  // "Finish practice" on the last queue entry (RH-169).
  const finish = usePracticeFinish({
    actions: PRACTICE_FINISH_ACTIONS, bandId: queryBandId, currentVersionId: versionId, entries: playlist.entries,
    nextId: playlist.nav?.nextId, offline: isOffline, notify: showToast, applyStatus: song.applyStatus,
  })

  if (song.loading) return <SongLoading />
  // Offline, "not found" is almost always "not downloaded" (snapshot reader answers null).
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
        currentVersionId={versionId}
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
              currentVersionId={versionId}
              onSelect={playlist.selectEntry}
            />

            {/* Song identity */}
            <SongIdentityHeader identity={identity} status={status} readOnly={readOnly} tuning={tuning} />
            <SpotifyPlayer links={entry.song?.links ?? []} offline={isOffline} />
            <YoutubeEmbed song={entry.song} offline={isOffline} />
            <OfflineSongButton versionId={versionId} bandId={queryBandId} actions={OFFLINE_DOWNLOAD_ACTIONS} offline={isOffline} />

            {/* Tabs Section */}
            <TabLibrarySection
              library={tabLibrary}
              loadingPersonal={song.loadingPersonal}
              onOpenStage={pdfStage.open}
              offline={isOffline}
              readOnly={readOnly}
            />

            <AudioLibrarySection songId={song.songId} actions={AUDIO_LIBRARY_ACTIONS} onPersonalEntryCreated={song.adoptPersonalEntry} notify={showToast} offline={isOffline} readOnly={readOnly} />

            {/* Links Section — `onDelete`'s wiring is documented on the prop */}
            <LinksSection
              controller={links}
              onDelete={(url) => {
                tabLibrary.cancelDelete()
                links.requestDelete(url)
              }}
              readOnly={readOnly}
            />

            {/* Lyrics Section */}
            <LyricsSection controller={lyrics} loadingPersonal={song.loadingPersonal} readOnly={readOnly} />

            {/* Map Section (RH-118) */}
            <SongMapSection controller={songMap} readOnly={readOnly} />

            {/* Tags Section */}
            <SongTagsSection tags={entry.tags} />

            <PracticeFinishButton finish={finish} />

            {/* Mobile / Tablet: Swipe hint strip (only when in a playlist) */}
            <SwipeHint nav={playlist.nav} />
          </main>
        </div>

        {/* Dedicated Right Setlist Sidebar on Desktop (`lg:flex`) */}
        <SetlistSidebar
          nav={playlist.nav}
          entries={playlist.entries}
          currentVersionId={versionId}
          onSelect={playlist.selectEntry}
        />
      </div>

      {finish.isOpen && (
        <PracticeReviewList review={finish.review} rows={finish.rows} levels={finish.levels} readOnly={false} onClose={finish.close} />
      )}

      {/* Stage Mode surfaces, the two confirmations and the floating Toast */}
      <FastViewOverlays
        identity={identity}
        lyrics={lyrics}
        pdfStage={pdfStage}
        tabLibrary={tabLibrary}
        links={links}
        toast={toast}
        onDismissToast={dismissToast}
        readOnly={readOnly}
      />
    </>
  )
}

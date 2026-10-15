"use client";

import { useEffect, useState, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Repertoire } from "@/types/database";
import { useRepertoireStore } from "@/store/repertoireStore";
import { useBandContextStore, type BandContext } from "@/store/bandContextStore";
import { useHydrated } from "@/hooks/useHydrated";
import { useBandRole, type BandRole } from "@/hooks/useBandRole";
import { STATUS_CONFIG } from "@/lib/statusConfig";
import { StatusFilterPills } from "@/components/songs/StatusFilterPills";
import { clearSongQueue } from "@/lib/songQueue";
import { shouldSearchPicker } from "@/lib/songPicker";
import type { ManualEntryActions } from "@/hooks/useManualEntry";
import { useRepertoireSearch,type RepertoireSearchActions } from "@/hooks/useRepertoireSearch";
import SongForm, { type SongFormActions } from "@/components/songs/SongForm";
import { AddToRepertoireSection } from "@/components/songs/AddToRepertoireSection";
import { StatusNotes } from "@/components/ui/StatusNotes";
import { PracticeStart } from "@/components/songs/PracticeStart";
import type { PracticeActions } from "@/hooks/usePracticeStart";
import { usePickedSelection } from "@/hooks/usePickedSelection";
import { PickableRowLink, SelectSongsButton, SongPickerBar } from "@/components/songs/SongPickerBar";

/**
 * RH-77 — the signed-in half of `/`, moved verbatim out of `src/app/page.tsx`
 * when that page became an async Server Component.
 *
 * The eight Server Actions it needs from `@/app/actions/*` are
 * injected instead: `src/components` must never point back into the App Router
 * tree (F21). `src/app/page.tsx` owns the bundle.
 */
export interface RepertoireDashboardActions
  extends SongFormActions,
    Pick<RepertoireSearchActions, "addSong" | "addVersion" | "searchSongs">,
    Pick<ManualEntryActions, "findCatalogSong"> {
  /** The caller's role in the active band (RH-96); see `useBandRole`. */
  getBandRole: (bandId: string) => Promise<BandRole>;
  /** RH-168: the two reads behind "Start practice". */
  practice: PracticeActions;
}

interface RepertoireDashboardProps {
  actions: RepertoireDashboardActions;
  /** RH-111: the page-built correction-outcome banner, shown under the header. */
  outcomeBanner?: ReactNode;
}

/** The context the server renders with: it cannot know the browser's band. */
const SERVER_BAND_CONTEXT: BandContext = { type: "user" };

type ModalState = { open: false } | { open: true; song?: Repertoire };

interface DeleteControlProps {
  title: string;
  confirming: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A row's delete button, which turns into an inline `Sure? Yes / No` confirm. */
function DeleteControl({ title, confirming, onAsk, onConfirm, onCancel }: DeleteControlProps) {
  if (confirming) {
    return (
      <span className="shrink-0 flex items-center gap-1">
        <span className="text-xs text-gray-600">Sure?</span>
        <button
          type="button"
          onClick={onConfirm}
          aria-label={`Confirm delete ${title}`}
          className="text-xs text-red-500 hover:text-red-700 focus:outline-none focus:underline"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel delete"
          className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
        >
          No
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onAsk}
      aria-label={`Delete ${title}`}
      className="shrink-0 text-red-500 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

function RepertoireDashboard({ actions, outcomeBanner }: RepertoireDashboardProps) {
  const {
    isLoading,
    searchQuery,
    selectedStatus,
    filteredSongs,
    songs: allSongs,
    loadSongs,
    setSearchQuery,
    setSelectedStatus,
    updateStatus,
    removeSong,
  } = useRepertoireStore();

  const storedBandContext = useBandContextStore((s) => s.context);
  const hydrated = useHydrated();
  // RH-77: `bandContextStore` rehydrates synchronously from `localStorage`, so
  // a band-mode user's first client render would already carry the band while
  // the server rendered the personal default. Everything derived from the
  // context — the title, the status badge, the empty-state copy and the
  // `?bandId=` query — reads the personal variant until hydration completes.
  const bandContext = hydrated ? storedBandContext : SERVER_BAND_CONTEXT;

  /** Stable per `actions` identity, as the module-level const used to be (RH-47). */
  const songFormActions: SongFormActions = useMemo(
    () => ({
      createAndAddSong: actions.createAndAddSong,
      updateSong: actions.updateSong,
      updateSongStatus: actions.updateSongStatus,
      updateSongTags: actions.updateSongTags,
      submitCatalogSuggestion: actions.submitCatalogSuggestion,
    }),
    [actions],
  );

  // RH-96: a band row's status is authored by a band admin, a personal row's by
  // its owner. `useBandRole` fails closed, so the control appears only once the
  // server has answered `admin` — as the gate on the write will.
  const bandRole = useBandRole(
    bandContext.type === "band" ? bandContext.id : null,
    actions.getBandRole,
  );
  const canEditStatus = bandContext.type !== "band" || bandRole === "admin";

  const manualActions: ManualEntryActions = useMemo(
    () => ({
      createAndAddSong: actions.createAndAddSong,
      updateSongStatus: actions.updateSongStatus,
      findCatalogSong: actions.findCatalogSong,
    }),
    [actions],
  );

  const [modal, setModal] = useState<ModalState>({ open: false });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const search = useRepertoireSearch({
    actions,
    query: searchQuery,
    entries: allSongs,
    onAdded: loadSongs,
  });

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  const songs = filteredSongs();

  // RH-170: picks are over every loaded row, so a filter never drops one.
  const router = useRouter();
  const pickRows = useMemo(
    () =>
      allSongs.map((s) => ({
        versionId: s.version_id,
        title: s.song?.title ?? "—",
        artist: s.song?.artist ?? null,
      })),
    [allSongs],
  );
  const picker = usePickedSelection({
    rows: pickRows,
    owner: bandContext.type === "band" ? { type: "band", bandId: bandContext.id } : { type: "personal" },
    originHref: "/",
    push: router.push,
  });

  const openAdd = () => setModal({ open: true });
  const openEdit = (song: Repertoire) => setModal({ open: true, song });
  const closeModal = () => setModal({ open: false });
  const handleSuccess = () => setModal({ open: false });

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 md:px-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 className="text-xl font-bold text-gray-900">
            {bandContext.type === 'band' ? `🎸 ${bandContext.name}` : 'My Repertoire'}
          </h1>
          <div className="flex gap-2">
            <SelectSongsButton picker={picker} />
            {!picker.active && <PracticeStart bandId={bandContext.type === 'band' ? bandContext.id : null} actions={actions.practice} originHref="/" />}
          </div>
        </div>

        <SongPickerBar picker={picker} />

        {/* Search */}
        <div className="mt-3">
          <label
            htmlFor="search-input"
            className="text-sm font-medium text-gray-700 mb-1 block"
          >
            Search
          </label>
          <input
            id="search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Title or artist..."
            className="w-full rounded-lg border border-gray-200 pl-3 pr-4 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Status filter pills */}
        <StatusFilterPills selected={selectedStatus} onSelect={setSelectedStatus} />
      </header>

      {outcomeBanner}

      {/* Song list */}
      <section
        className="flex-1 overflow-y-auto px-4 py-4 md:px-6"
        aria-label="Song list"
      >
        {isLoading ? (
          <div
            className="flex items-center justify-center h-40"
            aria-live="polite"
            aria-busy="true"
          >
            <p className="text-sm text-gray-400">Loading...</p>
          </div>
        ) : songs.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-40 text-center gap-2"
            aria-live="polite"
          >
            <p className="text-gray-500 font-medium">No songs found</p>
            <p className="text-sm text-gray-400">
              {searchQuery || selectedStatus
                ? "Try adjusting the filters."
                : bandContext.type === 'band'
                  ? `No songs in ${bandContext.name}'s repertoire yet.`
                  : "Add your first song with the + button"}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {songs.map((song) => {
              const cfg = STATUS_CONFIG[song.status];
              return (
                <li
                  key={song.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm hover:border-emerald-200 transition-colors"
                >
                  {/* RH-133: a song opened from here is opened alone, so the
                      tab's song queue is dropped as the link is followed —
                      otherwise the same song, clicked from a playlist and then
                      from this list, would keep that playlist's setlist chrome
                      and its Back target. The playlist path writes a queue at
                      this same point (`PlaylistSongList.onOpenFastView`). This
                      cannot cover a context-menu *Open Link in New Tab*, which
                      dispatches no click event and hands the new tab a copy of
                      the queue; recorded under **Open** in `docs/use-cases.md`
                      *Walk a queue of songs*. */}
                  <PickableRowLink
                    picker={picker}
                    versionId={song.version_id}
                    href={`/songs/${song.version_id}/fast-view${bandContext.type === 'band' ? `?bandId=${bandContext.id}` : ''}`}
                    onOpen={clearSongQueue}
                    className="flex flex-1 items-center gap-3 min-w-0 focus:outline-none"
                  >
                    {/* Cover image or status color square */}
                    {song.song?.cover_url ? (
                      <Image
                        src={song.song.cover_url}
                        alt={`${song.song.title} cover`}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded object-cover shrink-0"
                        unoptimized
                      />
                    ) : (
                      <div
                        className={`w-10 h-10 rounded shrink-0 ${cfg.bgColor}`}
                        aria-hidden="true"
                      />
                    )}

                    {/* Title + artist + album */}
                    <div className="flex-1 min-w-0 text-left">
                      <span className="block text-sm font-semibold text-gray-900 truncate hover:text-emerald-600 transition-colors">
                        {song.song?.title ?? "—"}
                      </span>
                      <p className="text-xs text-gray-500 truncate">
                        {song.song?.artist ?? "—"}
                      </p>
                      {song.song?.album && (
                        <p className="text-xs text-gray-400 italic truncate">
                          {song.song.album}
                        </p>
                      )}
                    </div>
                  </PickableRowLink>

                  {/* RH-102: four notes; RH-96's gate decides who may tap. */}
                  <StatusNotes
                    status={song.status}
                    readOnly={!canEditStatus}
                    onChange={(next) => updateStatus(song.id, next)}
                  />

                  {/* Edit button */}
                  <button
                    type="button"
                    onClick={() => openEdit(song)}
                    aria-label={`Edit ${song.song?.title ?? "song"}`}
                    className="shrink-0 text-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>

                  {/* Delete button with inline confirm */}
                  <DeleteControl
                    title={song.song?.title ?? "song"}
                    confirming={confirmDeleteId === song.id}
                    onAsk={() => setConfirmDeleteId(song.id)}
                    onConfirm={() => {
                      removeSong(song.id);
                      setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {/* Separator + addable results + manual entry (RH-151, RH-152) */}
        {shouldSearchPicker(searchQuery) && (
          <AddToRepertoireSection
            search={search}
            query={searchQuery}
            manualActions={manualActions}
            onAdded={loadSongs}
          />
        )}
      </section>

      {/* FAB — Add song */}
      <button
        type="button"
        onClick={openAdd}
        aria-label="Add song"
        className="fixed bottom-20 right-5 md:bottom-6 md:right-6 z-20 w-14 h-14 rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-300 transition-colors flex items-center justify-center text-2xl leading-none"
      >
        +
      </button>

      {/* Modal */}
      {modal.open && (
        <SongForm
          song={modal.song}
          onClose={closeModal}
          onSuccess={handleSuccess}
          actions={songFormActions}
        />
      )}
    </div>
  );
}

export default RepertoireDashboard;

"use client";

import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import type { CatalogAdminController, CatalogFlow } from "@/hooks/useCatalogAdmin";
import {
  canSplit,
  deleteVersionMessage,
  mergeSongsMessage,
  mergeVersionsMessage,
  splitMessage,
  sumRadii,
  versionDisplayLabel,
  type RadiusState,
} from "@/lib/catalogAdminPlan";
import type { BlastRadius } from "@/lib/catalogAdmin";
import type { CatalogSearchResult } from "@/types/database";

interface CatalogFlowPanelProps {
  song: CatalogSearchResult;
  /** Every song in the current results: the merge-song and split-existing targets. */
  allSongs: CatalogSearchResult[];
  flow: CatalogFlow;
  controller: CatalogAdminController;
}

const SELECT_CLASS = "rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs";
const INPUT_CLASS = "rounded-lg border border-gray-300 px-2 py-1 text-xs";
const PICK_BUTTON =
  "rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50";

function readyRadius(state: RadiusState | undefined): BlastRadius | null {
  return state?.status === "ready" ? state.radius : null;
}

function PickerShell({
  children,
  onCancel,
  busy,
}: {
  children: React.ReactNode;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
      {children}
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600"
      >
        Cancel
      </button>
    </div>
  );
}

function Confirm({
  message,
  label,
  controller,
}: {
  message: string;
  label: string;
  controller: CatalogAdminController;
}) {
  return (
    <ConfirmPanel
      message={message}
      confirmLabel={label}
      busy={controller.busy}
      onConfirm={controller.confirm}
      onCancel={controller.cancel}
    />
  );
}

function MergeVersionsFlow({
  song,
  flow,
  controller,
}: CatalogFlowPanelProps & { flow: Extract<CatalogFlow, { kind: "mergeVersions" }> }) {
  const from = song.versions.find((v) => v.versionId === flow.fromId);
  const into = song.versions.find((v) => v.versionId === flow.intoId);
  const radius = readyRadius(controller.radii[flow.fromId]);
  if (flow.confirming && from && into && radius) {
    const message = mergeVersionsMessage(
      versionDisplayLabel(from),
      versionDisplayLabel(into),
      radius,
    );
    return <Confirm message={message} label="Merge versions" controller={controller} />;
  }
  return (
    <PickerShell onCancel={controller.cancel} busy={controller.busy}>
      <label className="text-xs text-gray-600">
        Merge {from ? versionDisplayLabel(from) : "version"} into
        <select
          aria-label="Merge target"
          className={`${SELECT_CLASS} ml-2`}
          value={flow.intoId}
          onChange={(e) => controller.patchFlow({ intoId: e.target.value })}
        >
          <option value="">Choose a version</option>
          {song.versions
            .filter((v) => v.versionId !== flow.fromId)
            .map((v) => (
              <option key={v.versionId} value={v.versionId}>
                {versionDisplayLabel(v)}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        className={PICK_BUTTON}
        disabled={!flow.intoId || !radius || controller.busy}
        onClick={controller.review}
      >
        Review merge
      </button>
    </PickerShell>
  );
}

function splitTargetName(flow: Extract<CatalogFlow, { kind: "split" }>, allSongs: CatalogSearchResult[]) {
  if (flow.mode === "new") return `a new song "${flow.artist.trim()} - ${flow.title.trim()}"`;
  const target = allSongs.find((s) => s.id === flow.existingSongId);
  return `"${target?.title ?? "the chosen song"}"`;
}

function SplitFlow({
  song,
  allSongs,
  flow,
  controller,
}: CatalogFlowPanelProps & { flow: Extract<CatalogFlow, { kind: "split" }> }) {
  const radii = flow.chosen.map((id) => readyRadius(controller.radii[id]));
  const loaded = radii.every((r): r is BlastRadius => r !== null);
  const targetOk =
    flow.mode === "new"
      ? flow.artist.trim() !== "" && flow.title.trim() !== ""
      : flow.existingSongId !== "";
  const allTicked = flow.chosen.length === song.versions.length;
  const ready = canSplit(flow.chosen.length, song.versions.length) && loaded && targetOk;

  if (flow.confirming && ready) {
    const message = splitMessage(
      flow.chosen.length,
      sumRadii(radii as BlastRadius[]),
      splitTargetName(flow, allSongs),
    );
    return <Confirm message={message} label="Split versions" controller={controller} />;
  }
  return (
    <PickerShell onCancel={controller.cancel} busy={controller.busy}>
      <div className="w-full space-y-2">
        <p className="text-xs text-gray-600">Tick the versions to move, then choose where they go.</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label>
            <input
              type="radio"
              name={`split-mode-${song.id}`}
              checked={flow.mode === "new"}
              onChange={() => controller.patchFlow({ mode: "new", confirming: false })}
            />{" "}
            New song
          </label>
          <label>
            <input
              type="radio"
              name={`split-mode-${song.id}`}
              checked={flow.mode === "existing"}
              onChange={() => controller.patchFlow({ mode: "existing", confirming: false })}
            />{" "}
            Existing song
          </label>
        </div>
        {flow.mode === "new" ? (
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="New song artist"
              className={INPUT_CLASS}
              value={flow.artist}
              onChange={(e) => controller.patchFlow({ artist: e.target.value })}
            />
            <input
              aria-label="New song title"
              className={INPUT_CLASS}
              value={flow.title}
              onChange={(e) => controller.patchFlow({ title: e.target.value })}
            />
          </div>
        ) : (
          <select
            aria-label="Existing song"
            className={SELECT_CLASS}
            value={flow.existingSongId}
            onChange={(e) => controller.patchFlow({ existingSongId: e.target.value })}
          >
            <option value="">Choose a song</option>
            {allSongs
              .filter((s) => s.id !== song.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} - {s.artist}
                </option>
              ))}
          </select>
        )}
        {allTicked && (
          <p className="text-xs text-amber-700">
            Every version is ticked: moving them all is a song merge, use Merge song into... instead.
          </p>
        )}
        <button
          type="button"
          className={PICK_BUTTON}
          disabled={!ready || controller.busy}
          onClick={controller.review}
        >
          Review split
        </button>
      </div>
    </PickerShell>
  );
}

function MergeSongsFlow({
  song,
  allSongs,
  flow,
  controller,
}: CatalogFlowPanelProps & { flow: Extract<CatalogFlow, { kind: "mergeSongs" }> }) {
  const into = allSongs.find((s) => s.id === flow.intoSongId);
  const state = controller.songRadius;
  if (flow.confirming && into) {
    if (state?.status === "ready") {
      const message = mergeSongsMessage(song.title, into.title, state.radius);
      return <Confirm message={message} label="Merge songs" controller={controller} />;
    }
    return (
      <PickerShell onCancel={controller.cancel} busy={controller.busy}>
        <p className="text-xs text-gray-600">
          {state?.status === "error" ? `Counts unavailable: ${state.message}` : "Loading counts..."}
        </p>
      </PickerShell>
    );
  }
  return (
    <PickerShell onCancel={controller.cancel} busy={controller.busy}>
      <label className="text-xs text-gray-600">
        Merge {song.title} into
        <select
          aria-label="Merge song target"
          className={`${SELECT_CLASS} ml-2`}
          value={flow.intoSongId}
          onChange={(e) => controller.patchFlow({ intoSongId: e.target.value })}
        >
          <option value="">Choose a song</option>
          {allSongs
            .filter((s) => s.id !== song.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} - {s.artist}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        className={PICK_BUTTON}
        disabled={!flow.intoSongId || controller.busy}
        onClick={controller.review}
      >
        Review merge
      </button>
    </PickerShell>
  );
}

/** The step-by-step panel of the one open flow; every flow ends in a ConfirmPanel. */
export function CatalogFlowPanel(props: CatalogFlowPanelProps) {
  const { flow, song, controller } = props;
  if (flow.kind === "mergeVersions") return <MergeVersionsFlow {...props} flow={flow} />;
  if (flow.kind === "split") return <SplitFlow {...props} flow={flow} />;
  if (flow.kind === "mergeSongs") return <MergeSongsFlow {...props} flow={flow} />;
  const version = song.versions.find((v) => v.versionId === flow.versionId);
  const label = version ? versionDisplayLabel(version) : "this version";
  return <Confirm message={deleteVersionMessage(label)} label="Delete version" controller={controller} />;
}

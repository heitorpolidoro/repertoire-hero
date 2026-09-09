import type { GlobalSongEdit } from "@/types/database";

interface PendingEditDiffProps {
  song: GlobalSongEdit["song"];
  proposed: Record<string, unknown>;
}

/**
 * The current-vs-proposed grid of one queued edit. Presentational and stateless:
 * it lives in its own file because the four `song?.x || "N/A"` pairs alone cost
 * eight complexity points, which is what would push a single card component over
 * the base budget of 15 (F20).
 */
export function PendingEditDiff({ song, proposed }: PendingEditDiffProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl text-xs">
      <div className="space-y-2">
        <h3 className="font-bold text-gray-600 uppercase tracking-wider text-[10px]">
          Current Song Details
        </h3>
        <p>
          <span className="font-medium text-gray-500">Title:</span>{" "}
          <span className="font-semibold text-gray-900">
            {song?.title || "N/A"}
          </span>
        </p>
        <p>
          <span className="font-medium text-gray-500">Artist:</span>{" "}
          <span className="text-gray-800">
            {song?.artist || "N/A"}
          </span>
        </p>
        <p>
          <span className="font-medium text-gray-500">Album:</span>{" "}
          <span className="text-gray-800">
            {song?.album || "N/A"}
          </span>
        </p>
        <p>
          <span className="font-medium text-gray-500">Key:</span>{" "}
          <span className="text-gray-800">
            {song?.standard_key || "N/A"}
          </span>
        </p>
      </div>

      <div className="space-y-2 border-t md:border-t-0 md:border-l border-gray-200 pt-3 md:pt-0 md:pl-4">
        <h3 className="font-bold text-emerald-700 uppercase tracking-wider text-[10px]">
          Proposed Edits
        </h3>
        {Object.entries(proposed).map(([key, val]) => (
          <p key={key}>
            <span className="font-medium text-gray-500 capitalize">
              {key.replace("_", " ")}:
            </span>{" "}
            <span className="font-semibold text-emerald-900">
              {typeof val === "object"
                ? JSON.stringify(val)
                : String(val)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

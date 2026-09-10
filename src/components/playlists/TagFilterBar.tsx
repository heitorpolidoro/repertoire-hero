"use client";

export interface TagFilterBarProps {
  /** Every tag the playlist's songs carry, already deduplicated and sorted. */
  tags: string[];
  /** The tag currently filtering the list, or `null`. */
  activeTag: string | null;
  /** Called with the newly selected tag, or `null` to clear the filter. */
  onChange: (tag: string | null) => void;
}

/**
 * RH-69 — the tag filter above the song list of `/playlists/[id]`: one button
 * per tag present in the playlist, plus an `× clear` control while a tag is
 * active. It renders nothing at all when no song carries a tag.
 *
 * The toggle is its own decision — clicking the active tag clears the filter —
 * so the page hands it `setActiveTagFilter` directly and holds no branch of its
 * own. Each button is named exactly the tag, which is how the e2e net tells a
 * filter entry from a chip's `Remove tag <tag>` button.
 */
export function TagFilterBar({ tags, activeTag, onChange }: TagFilterBarProps) {
  if (tags.length === 0) return null;

  return (
    <div className="px-4 md:px-6 pb-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onChange(activeTag === tag ? null : tag)}
          className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
            activeTag === tag
              ? "bg-emerald-600 text-white border-emerald-600"
              : "bg-white text-emerald-700 border-emerald-200 hover:border-emerald-400"
          }`}
        >
          {tag}
        </button>
      ))}
      {activeTag && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="px-2 py-0.5 rounded-full text-xs text-gray-400 hover:text-gray-600 border border-gray-200"
        >
          × clear
        </button>
      )}
    </div>
  );
}

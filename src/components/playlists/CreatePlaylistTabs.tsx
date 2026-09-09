"use client";

export type CreatePlaylistTab = "new" | "spotify";

interface CreatePlaylistTabsProps {
  activeTab: CreatePlaylistTab;
  /** The server resolved the Spotify connection; `false` disables the tab. */
  canShowSpotifyTab: boolean;
  onSelectNew: () => void;
  onSelectSpotify: () => void;
}

const tabClass = (active: boolean, enabled: boolean): string => {
  const base =
    "flex-1 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500";
  if (active) return `${base} text-emerald-700 border-b-2 border-emerald-600`;
  return enabled
    ? `${base} text-gray-500 hover:text-gray-700`
    : `${base} text-gray-300 cursor-not-allowed`;
};

export const CreatePlaylistTabs = ({
  activeTab,
  canShowSpotifyTab,
  onSelectNew,
  onSelectSpotify,
}: CreatePlaylistTabsProps) => (
  <div className="flex border-b border-gray-100">
    <button
      type="button"
      onClick={onSelectNew}
      className={tabClass(activeTab === "new", true)}
    >
      New playlist
    </button>
    <button
      type="button"
      onClick={() => {
        if (canShowSpotifyTab) onSelectSpotify();
      }}
      disabled={!canShowSpotifyTab}
      title={
        !canShowSpotifyTab
          ? "Connect your Spotify account in Profile & Settings"
          : undefined
      }
      className={tabClass(activeTab === "spotify", canShowSpotifyTab)}
    >
      From Spotify
    </button>
  </div>
);

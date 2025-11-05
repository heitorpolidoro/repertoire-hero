'use client';

import { useState, useEffect } from 'react';
import Sidebar from "@/components/Sidebar";
import { Song, Playlist } from "@/types";

export default function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistSongs, setPlaylistSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlaylists().catch(console.error);
  }, []);

  const fetchPlaylists = async () => {
    try {
      const response = await fetch('/api/playlists');

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to fetch playlists');
        return;
      }

      const data = await response.json();
      setPlaylists(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching playlists:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const fetchPlaylistSongs = async (playlist: Playlist) => {
    setLoadingSongs(true);
    try {
      const response = await fetch('/api/songs');
      if (!response.ok) return;

      const allSongs = await response.json();
      const filteredSongs = allSongs.filter((song: Song) =>
        playlist.songs.includes(song._id)
      );
      setPlaylistSongs(filteredSongs);
    } catch (error) {
      console.error('Error fetching playlist songs:', error);
    } finally {
      setLoadingSongs(false);
    }
  };

  const handlePlaylistClick = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    fetchPlaylistSongs(playlist);
  };

  return (
    <div className="flex min-h-screen bg-black">
      <Sidebar activeItem="Playlists" />
      <main className="flex-1 p-8">
        <h2 className="text-3xl font-bold text-white mb-8">Your Playlists</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Playlists Column */}
          <div className="bg-gray-900 rounded-lg p-6">
            {loading && <p className="text-gray-400">Loading playlists...</p>}

            {!loading && error && (
              <div className="text-center py-8">
                <p className="text-red-400 mb-4">{error}</p>
                <button
                  onClick={fetchPlaylists}
                  className="px-6 py-3 bg-green-500 text-black font-semibold rounded-full hover:bg-green-400 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && playlists.length === 0 && (
              <p className="text-gray-400">No playlists found.</p>
            )}

            {!loading && !error && playlists.length > 0 && (
              <div className="space-y-2">
                {playlists.map((playlist) => (
                  <button
                    key={playlist._id}
                    onClick={() => handlePlaylistClick(playlist)}
                    className={`w-full text-left p-4 rounded-lg transition-all duration-200 ${
                      selectedPlaylist?._id === playlist._id 
                        ? 'bg-gray-700 border-l-4 border-green-500' 
                        : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    <h4 className="font-semibold text-white text-lg">{playlist.title}</h4>
                    <p className="text-gray-400 text-sm">{playlist.songs.length} songs</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Songs Column */}
          <div className="bg-gray-900 rounded-lg p-6">
            <h3 className="text-xl font-semibold text-white mb-6">
              {selectedPlaylist ? selectedPlaylist.title : 'Select a playlist'}
            </h3>

            {!selectedPlaylist && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🎵</div>
                <p className="text-gray-400">Choose a playlist to see its tracks</p>
              </div>
            )}

            {selectedPlaylist && loadingSongs && (
              <p className="text-gray-400">Loading songs...</p>
            )}

            {selectedPlaylist && !loadingSongs && playlistSongs.length === 0 && (
              <p className="text-gray-400">No songs in this playlist.</p>
            )}

            {selectedPlaylist && !loadingSongs && playlistSongs.length > 0 && (
              <div className="space-y-1">
                {playlistSongs.map((song, index) => (
                  <div key={song._id} className="flex items-center p-3 rounded-lg hover:bg-gray-800 transition-colors group">
                    <div className="w-8 text-gray-400 text-sm font-medium">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-white truncate">{song.title}</h4>
                      <p className="text-gray-400 text-sm truncate">{song.artist}</p>
                    </div>
                    <div className="text-gray-400 text-sm bg-gray-800 px-2 py-1 rounded-full">
                      {song.genre}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

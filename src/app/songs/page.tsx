'use client';

import { useState, useEffect } from 'react';
import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";
import { Song } from "@/types";

export default function Songs() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSongs().catch(console.error);
  }, []);

  const fetchSongs = async () => {
    try {
      const response = await fetch('/api/songs');
      
      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to fetch songs');
        return;
      }
      
      const data = await response.json();
      setSongs(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching songs:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-black">
        <Sidebar activeItem="Songs" />
        <main className="flex-1 p-8">
          <h2 className="text-3xl font-bold text-white mb-8">Songs</h2>
          <div className="bg-gray-900 rounded-lg p-6">
            <p className="text-gray-400 mb-4">Available songs library.</p>
            
            {loading && <p className="text-gray-400">Loading songs...</p>}
            
            {!loading && error && (
              <div className="text-center py-8">
                <p className="text-red-400 mb-4">{error}</p>
                <button 
                  onClick={fetchSongs}
                  className="px-6 py-3 bg-green-500 text-black font-semibold rounded-full hover:bg-green-400 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            
            {!loading && !error && songs.length === 0 && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🎵</div>
                <p className="text-gray-400">No songs found. Add some songs to get started.</p>
              </div>
            )}
            
            {!loading && !error && songs.length > 0 && (
              <div className="space-y-1">
                {songs.map((song, index) => (
                  <div key={song._id} className="flex items-center p-3 rounded-lg hover:bg-gray-800 transition-colors">
                    <div className="w-8 text-gray-400 text-sm font-medium">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-white truncate">{song.title}</h3>
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
        </main>
      </div>
    </AuthGuard>
  );
}

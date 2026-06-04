'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SpotifyPlaylist } from '@/types/database';

const SettingsPage = () => {
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSpotifyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/playlists');
      const body = (await res.json()) as SpotifyPlaylist[] | { connected: false };
      if (!Array.isArray(body) && body.connected === false) {
        setSpotifyConnected(false);
      } else {
        setSpotifyConnected(true);
      }
    } catch {
      setSpotifyConnected(false);
    }
  }, []);

  useEffect(() => {
    loadSpotifyStatus().catch(console.error);
  }, [loadSpotifyStatus]);

  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/spotify/disconnect', { method: 'POST' });
      setSpotifyConnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Spotify');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 md:px-6">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 flex flex-col gap-6 max-w-lg">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3"
          >
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 text-xs focus:outline-none"
            >
              x
            </button>
          </div>
        )}

        {/* Spotify section */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Spotify</h2>

          {spotifyConnected === null && (
            <div
              className="rounded-lg border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-2 text-sm text-gray-400"
              aria-live="polite"
              aria-busy="true"
            >
              <svg
                className="animate-spin h-4 w-4 text-emerald-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              Checking Spotify connection...
            </div>
          )}

          {spotifyConnected === false && (
            <div
              className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              role="region"
              aria-label="Spotify connection"
            >
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  <span aria-hidden="true">🎵</span> Connect your Spotify account
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Import playlists and keep them in sync.
                </p>
              </div>
              <a
                href="/api/auth/spotify/authorize"
                className="shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors"
              >
                Connect Spotify
              </a>
            </div>
          )}

          {spotifyConnected === true && (
            <div
              className="rounded-lg border border-gray-100 bg-white shadow-sm px-4 py-3 flex flex-wrap items-center gap-3"
              role="region"
              aria-label="Spotify connection"
            >
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium border border-green-200">
                <span aria-hidden="true">✓</span> Connected to Spotify
              </span>
              <button
                type="button"
                onClick={() => handleDisconnect().catch(console.error)}
                className="text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus:underline"
              >
                Disconnect
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;

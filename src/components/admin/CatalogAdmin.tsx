"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CatalogSongCard } from "@/components/admin/CatalogSongCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { Toast } from "@/components/ui/Toast";
import { useCatalogAdmin } from "@/hooks/useCatalogAdmin";
import type { CatalogAdminActions } from "@/lib/catalogAdminPlan";
import type { CatalogSearchResult } from "@/types/database";

interface CatalogAdminProps {
  /** The `?q=` term the server searched with. */
  query: string;
  /** Read on the server by `searchSongs(query)`; this island never searches. */
  songs: CatalogSearchResult[];
  actions: CatalogAdminActions;
}

/**
 * The system admin's catalog screen (RH-156): search, then merge, split and
 * delete on the versions of what was found. Search navigates (`?q=`), so the
 * results are always server-rendered and a mutation is followed by a refresh.
 */
export function CatalogAdmin({ query, songs, actions }: CatalogAdminProps) {
  const router = useRouter();
  const controller = useCatalogAdmin(actions);
  const [term, setTerm] = useState(query);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = term.trim();
    router.push(trimmed ? `/admin/catalog?q=${encodeURIComponent(trimmed)}` : "/admin/catalog");
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Catalog</h1>
      <form onSubmit={submit} className="flex gap-2" role="search">
        <input
          type="search"
          aria-label="Search songs"
          placeholder="Search by title or artist"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Search
        </button>
      </form>

      {controller.error && (
        <AlertBanner tone="error" message={controller.error} onDismiss={controller.dismissError} />
      )}

      {!query && (
        <p className="text-sm text-gray-500">Search for a song to merge, split or clean up its versions.</p>
      )}
      {query && songs.length === 0 && (
        <p className="text-sm text-gray-500">No songs match &ldquo;{query}&rdquo;.</p>
      )}

      <div className="space-y-3">
        {songs.map((song) => (
          <CatalogSongCard key={song.id} song={song} allSongs={songs} controller={controller} />
        ))}
      </div>

      {controller.toast && (
        <Toast
          message={controller.toast.message}
          tone={controller.toast.tone}
          onDismiss={controller.dismissToast}
        />
      )}
    </div>
  );
}

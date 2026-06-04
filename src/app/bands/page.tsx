"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getBandsAction as getBands, createBandAction as createBand } from "@/app/actions/bands";
import type { Band } from "@/types/database";
const BandImage = ({ band }: { band: Band }) => {
  return band.cover_url ? (
    <Image
      src={band.cover_url}
      alt={band.name}
      width={48}
      height={48}
      className="w-12 h-12 rounded-xl object-cover shrink-0"
      unoptimized
    />
  ) : (
    <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-2xl shrink-0">
      🎸
    </div>
  );
};

const BandInfo = ({ band }: { band: Band }) => {
  return (
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-gray-900 truncate">{band.name}</p>
      {band.description && (
        <p className="text-sm text-gray-500 truncate">{band.description}</p>
      )}
    </div>
  );
};

const BandListItem = ({ band }: { band: Band }) => {
  const router = useRouter();
  return (
    <li key={band.id}>
      <button
        onClick={() => router.push(`/bands/${band.id}`)}
        className="w-full text-left bg-white rounded-2xl shadow-sm border border-gray-200 px-5 py-4 hover:border-emerald-300 hover:shadow-md transition-all"
      >
        <div className="flex items-center gap-4">
          <BandImage band={band} />
          <BandInfo band={band} />
          <span className="text-gray-400 text-lg">›</span>
        </div>
      </button>
    </li>
  );
};

export default function BandsPage() {
  const router = useRouter();
  const [bands, setBands] = useState<Band[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBands()
      .then(setBands)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const bandId = await createBand(newName.trim(), newDesc.trim() || null);
      router.push(`/bands/${bandId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create band");
      setCreating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bands</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
        >
          + New Band
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5 space-y-4"
        >
          <h2 className="font-semibold text-gray-900">Create a new band</h2>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Band name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              placeholder="The Rolling Stones"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Description{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="A brief description"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
            >
              {creating ? "Creating..." : "Create Band"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading bands...</p>
      ) : bands.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-4">🎸</div>
          <p className="font-medium">No bands yet</p>
          <p className="text-sm mt-1">
            Create one or ask a bandmate for an invite link.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {bands.map((band) => (
            <BandListItem key={band.id} band={band} />
          ))}
        </ul>
      )}
    </div>
  );
}

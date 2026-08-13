"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface DevProfile {
  id: string;
  email: string;
  full_name: string | null;
}

export default function LandingPage() {
  const [devProfiles, setDevProfiles] = useState<DevProfile[]>([]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    fetch("/api/dev/profiles")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: DevProfile[]) => {
        if (Array.isArray(data)) setDevProfiles(data);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-gray-900/80 backdrop-blur-md border-b border-gray-800 px-4 md:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center text-xl shadow-md shadow-emerald-950/50">
            🎸
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            Repertoire Hero
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-gray-950 shadow-md shadow-emerald-950/40 transition-all transform active:scale-95"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative px-4 md:px-8 pt-16 pb-20 max-w-5xl mx-auto text-center flex flex-col items-center gap-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-800/50 text-xs font-semibold text-emerald-400 backdrop-blur-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Built for Musicians & Bands
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.15] max-w-3xl">
            Master Your Setlist. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500">
              Anywhere. Together.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-gray-400 max-w-2xl font-normal leading-relaxed">
            The all-in-one repertoire manager for individual musicians and bands.
            Catalog songs, track mastery stages, share setlists, and pull up chords & tabs instantly on stage.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/signup"
              className="px-6 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-base font-bold shadow-lg shadow-emerald-950/60 transition-all transform hover:-translate-y-0.5"
            >
              Start Free Catalog
            </Link>
            <Link
              href="/login"
              className="px-6 py-3.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-base font-semibold border border-gray-700 transition-all"
            >
              Sign In to Your Repertoire
            </Link>
          </div>

          {/* Dev Fast Login Notice in Dev Mode */}
          {process.env.NODE_ENV === "development" && devProfiles.length > 0 && (
            <div className="mt-6 p-4 rounded-xl bg-gray-800/80 border border-emerald-900/60 max-w-md w-full text-left">
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 text-center">
                ⚡ Dev Fast Login Available
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {devProfiles.map((p) => (
                  <Link
                    key={p.id}
                    href={`/login?email=${encodeURIComponent(p.email)}`}
                    className="px-3 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-xs font-medium border border-emerald-700/50 transition-colors"
                  >
                    Login as {p.full_name ?? p.email.split("@")[0]}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Feature Cards Grid */}
        <section className="px-4 md:px-8 py-16 bg-gray-950/60 border-y border-gray-800/80">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                Everything You Need For Practice & Stage
              </h2>
              <p className="text-sm sm:text-base text-gray-400 mt-2">
                Designed to stop song knowledge from being scattered across chats and folders.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  📚
                </div>
                <h3 className="text-lg font-bold text-white">Song Catalog</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Catalog songs with title, artist, album, key, cover art, duration, and external links to Spotify, YouTube, or Cifra Club.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  🎯
                </div>
                <h3 className="text-lg font-bold text-white">5-Stage Mastery Scale</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Track song progress with a 5-stage scale: <span className="text-gray-300 font-semibold">Unknown → Learning → Practicing → Polishing → Mastered</span>.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  👥
                </div>
                <h3 className="text-lg font-bold text-white">Band Shared Repertoires</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Create bands, invite members with a link, and view aggregate readiness calculated automatically via the &quot;weakest link&quot; rule.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  ⚡
                </div>
                <h3 className="text-lg font-bold text-white">Stage-Ready Fast View</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  A mobile-optimized reading mode for music stands. Swipe between songs in a setlist, view lyrics with chord tags, and switch to Stage Mode.
                </p>
              </div>

              {/* Feature 5 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  📄
                </div>
                <h3 className="text-lg font-bold text-white">PDF Tab & Sheet Uploads</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Attach PDF chord charts and tablatures to any song. Keep personal study PDFs or share official charts with your entire band.
                </p>
              </div>

              {/* Feature 6 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  🎧
                </div>
                <h3 className="text-lg font-bold text-white">Spotify Integration</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Search songs directly on Spotify and import entire playlists into your personal or band repertoire with one click.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Call to Action Banner */}
        <section className="px-4 md:px-8 py-20 text-center max-w-4xl mx-auto flex flex-col items-center gap-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Ready to Take Your Setlist to the Next Stage?
          </h2>
          <p className="text-base text-gray-400 max-w-xl">
            Join Repertoire Hero today and keep your music cataloged, synchronized, and gig-ready.
          </p>
          <Link
            href="/signup"
            className="px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-lg font-bold shadow-xl shadow-emerald-950/80 transition-all transform hover:-translate-y-0.5"
          >
            Create Your Free Account
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/80 py-8 px-4 text-center text-xs text-gray-500">
        <p>© {new Date().getFullYear()} Repertoire Hero. All rights reserved.</p>
      </footer>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { COOKIE_NAME, getDictionary, type Locale } from "@/lib/i18n";
import { LanguageSelector } from "@/components/layout/LanguageSelector";

interface DevProfile {
  id: string;
  email: string;
  full_name: string | null;
}

function getLocaleCookie(): Locale {
  if (typeof document === "undefined") return "pt-BR";
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const val = match ? decodeURIComponent(match[1]) : null;
  return val === "en" ? "en" : "pt-BR";
}

export default function LandingPage() {
  const [devProfiles, setDevProfiles] = useState<DevProfile[]>([]);
  const [locale, setLocale] = useState<Locale>("pt-BR");

  useEffect(() => {
    setLocale(getLocaleCookie());
    if (process.env.NODE_ENV !== "development") return;
    fetch("/api/dev/profiles")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: DevProfile[]) => {
        if (Array.isArray(data)) setDevProfiles(data);
      })
      .catch(() => {});
  }, []);

  const dict = getDictionary(locale);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-gray-900/80 backdrop-blur-md border-b border-gray-800 px-4 md:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center text-xl shadow-md shadow-emerald-950/50">
            🎸
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            {dict.common.appName}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <LanguageSelector />
          <Link
            href="/login"
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
          >
            {dict.nav.signIn}
          </Link>
          <Link
            href="/signup"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-gray-950 shadow-md shadow-emerald-950/40 transition-all transform active:scale-95"
          >
            {dict.nav.getStarted}
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative px-4 md:px-8 pt-16 pb-20 max-w-5xl mx-auto text-center flex flex-col items-center gap-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-800/50 text-xs font-semibold text-emerald-400 backdrop-blur-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {dict.landing.badge}
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.15] max-w-3xl">
            {dict.landing.title} <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500">
              {dict.landing.titleGradient}
            </span>
          </h1>

          <p className="text-base sm:text-lg text-gray-400 max-w-2xl font-normal leading-relaxed">
            {dict.landing.subtitle}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/signup"
              className="px-6 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-base font-bold shadow-lg shadow-emerald-950/60 transition-all transform hover:-translate-y-0.5"
            >
              {dict.landing.startFree}
            </Link>
            <Link
              href="/login"
              className="px-6 py-3.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-base font-semibold border border-gray-700 transition-all"
            >
              {dict.landing.signInToRepertoire}
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
                {dict.landing.featuresTitle}
              </h2>
              <p className="text-sm sm:text-base text-gray-400 mt-2">
                {dict.landing.featuresSubtitle}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  📚
                </div>
                <h3 className="text-lg font-bold text-white">{dict.landing.f1Title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {dict.landing.f1Desc}
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  🎯
                </div>
                <h3 className="text-lg font-bold text-white">{dict.landing.f2Title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {dict.landing.f2Desc}
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  👥
                </div>
                <h3 className="text-lg font-bold text-white">{dict.landing.f3Title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {dict.landing.f3Desc}
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  ⚡
                </div>
                <h3 className="text-lg font-bold text-white">{dict.landing.f4Title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {dict.landing.f4Desc}
                </p>
              </div>

              {/* Feature 5 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  📄
                </div>
                <h3 className="text-lg font-bold text-white">{dict.landing.f5Title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {dict.landing.f5Desc}
                </p>
              </div>

              {/* Feature 6 */}
              <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 hover:border-emerald-800/50 transition-all flex flex-col gap-3 group">
                <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/40 text-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  🎧
                </div>
                <h3 className="text-lg font-bold text-white">{dict.landing.f6Title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {dict.landing.f6Desc}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Call to Action Banner */}
        <section className="px-4 md:px-8 py-20 text-center max-w-4xl mx-auto flex flex-col items-center gap-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            {dict.landing.ctaTitle}
          </h2>
          <p className="text-base text-gray-400 max-w-xl">
            {dict.landing.ctaSubtitle}
          </p>
          <Link
            href="/signup"
            className="px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-lg font-bold shadow-xl shadow-emerald-950/80 transition-all transform hover:-translate-y-0.5"
          >
            {dict.landing.ctaButton}
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/80 py-8 px-4 text-center text-xs text-gray-500">
        <p>{dict.landing.footer.replace("{year}", new Date().getFullYear().toString())}</p>
      </footer>
    </div>
  );
}

'use client'

export interface LinkIconProps {
  url: string
}

/**
 * The icon of a song link, picked from the host: Spotify, YouTube, a chord
 * site (CifraClub / Ultimate Guitar), a document (Drive, Docs, a `.pdf`) or the
 * generic chain link.
 *
 * Presentational only — the five branches are the page's former `getLinkIcon`,
 * moved verbatim so every colour and path stays identical (RH-52).
 */
export function LinkIcon({ url }: LinkIconProps) {
  const lowercaseUrl = url.toLowerCase()

  if (lowercaseUrl.includes('spotify.com')) {
    return (
      <svg className="w-5 h-5 text-[#1DB954] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.893-.982-.336.075-.67-.136-.75-.472-.075-.336.136-.67.472-.75 3.856-.882 7.15-.508 9.825 1.13.295.18.387.565.207.865zm1.224-2.722c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.082-1.182-.413.125-.85-.107-.975-.52-.125-.413.107-.85.52-.975 3.666-1.112 8.243-.574 11.378 1.353.367.226.487.707.26 1.074zm.107-2.825C14.398 8.66 8.398 8.462 4.907 9.522c-.53.16-1.09-.14-1.25-.67-.16-.53.14-1.09.67-1.25 3.997-1.213 10.63-1.002 14.735 1.442.477.283.633.9.35 1.377-.283.477-.9.633-1.377.35z"/>
      </svg>
    )
  }

  if (lowercaseUrl.includes('youtube.com') || lowercaseUrl.includes('youtu.be')) {
    return (
      <svg className="w-5 h-5 text-[#FF0000] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.518 3.545 12 3.545 12 3.545s-7.518 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11C4.482 20.455 12 20.455 12 20.455s7.518 0 9.388-.508a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    )
  }

  if (lowercaseUrl.includes('cifraclub.com.br') || lowercaseUrl.includes('cifraclub.com') || lowercaseUrl.includes('ultimate-guitar.com')) {
    return (
      <svg className="w-5 h-5 text-[#FFB600] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    )
  }

  if (lowercaseUrl.includes('drive.google.com') || lowercaseUrl.includes('docs.google.com') || lowercaseUrl.endsWith('.pdf')) {
    return (
      <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )
  }

  // Generic Link Icon
  return (
    <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  )
}

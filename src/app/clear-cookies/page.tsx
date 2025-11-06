'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ClearCookies() {
  const router = useRouter();

  useEffect(() => {
    // Clear all NextAuth cookies
    const cookies = [
      'next-auth.session-token',
      '__Secure-next-auth.session-token',
      'next-auth.csrf-token',
      '__Host-next-auth.csrf-token',
      'next-auth.callback-url',
      '__Secure-next-auth.callback-url'
    ];

    cookies.forEach(cookieName => {
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.localhost;`;
    });

    // Clear localStorage
    localStorage.clear();
    sessionStorage.clear();

    setTimeout(() => {
      router.push('/login');
    }, 1000);
  }, [router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Clearing cookies...</h1>
        <p className="text-gray-400">Redirecting to login...</p>
      </div>
    </div>
  );
}

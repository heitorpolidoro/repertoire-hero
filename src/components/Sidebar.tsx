'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';

interface SidebarProps {
  activeItem: string;
}

export default function Sidebar({ activeItem }: SidebarProps) {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });
  }, [supabase.auth]);
  
  const menuItems = [
    { href: "/", label: "Dashboard" },
    { href: "/playlists", label: "Playlists" },
    { href: "/songs", label: "Songs" },
    { href: "/settings", label: "Settings" },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="w-64 bg-black border-r border-gray-800 flex flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white">🎵 Repertoire Hero</h1>
      </div>
      
      {user && (
        <div className="px-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold">
              {user.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {user.user_metadata?.full_name || user.email?.split('@')[0]}
              </p>
              <p className="text-gray-400 text-xs truncate">
                {user.email}
              </p>
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1">
        {menuItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`flex items-center px-6 py-3 text-gray-300 hover:text-white transition-colors ${
              activeItem === item.label
                ? "text-white bg-gray-900 border-r-4 border-green-500"
                : "hover:bg-gray-900"
            }`}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {user && (
        <div className="p-6 border-t border-gray-800">
          <button
            onClick={handleSignOut}
            className="w-full text-left text-gray-400 hover:text-white text-sm"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}

'use client';

import { signOut, useSession } from 'next-auth/react';

interface SidebarProps {
  activeItem: string;
}

export default function Sidebar({ activeItem }: SidebarProps) {
  const { data: session } = useSession();
  
  const menuItems = [
    { href: "/", label: "Dashboard" },
    { href: "/playlists", label: "Playlists" },
    { href: "/songs", label: "Songs" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <aside className="w-64 bg-black border-r border-gray-800 flex flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white">🎵 Repertoire Hero</h1>
      </div>
      
      {session && (
        <div className="px-6 pb-4">
          <div className="flex items-center gap-3">
            <img 
              src={session.user?.image || ''} 
              alt="Profile" 
              className="w-10 h-10 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {session.user?.name}
              </p>
              <p className="text-gray-400 text-xs truncate">
                {session.user?.email}
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

      {session && (
        <div className="p-6 border-t border-gray-800">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-left text-gray-400 hover:text-white text-sm"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}

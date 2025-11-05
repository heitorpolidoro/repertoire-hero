interface SidebarProps {
  activeItem: string;
}

export default function Sidebar({ activeItem }: SidebarProps) {
  const menuItems = [
    { href: "/", label: "Dashboard" },
    { href: "/playlists", label: "Playlists" },
    { href: "/songs", label: "Songs" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <aside className="w-64 bg-black border-r border-gray-800">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white">🎵 Repertoire Hero</h1>
      </div>
      <nav className="mt-6">
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
    </aside>
  );
}

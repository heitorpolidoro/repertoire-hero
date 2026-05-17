import Sidebar from "@/components/Sidebar";
import AuthGuard from "@/components/AuthGuard";

export default function Home() {
  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-black">
        <Sidebar activeItem="Dashboard" />
        <main className="flex-1 p-8">
          <h2 className="text-3xl font-bold text-white mb-8">Dashboard</h2>
          <div className="bg-gray-900 rounded-lg p-6">
            <p className="text-gray-400">Welcome to Repertoire Hero!</p>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}

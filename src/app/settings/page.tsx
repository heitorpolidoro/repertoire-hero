import Sidebar from "@/components/Sidebar";

export default function Settings() {
  return (
    <div className="flex min-h-screen bg-black">
      <Sidebar activeItem="Settings" />
      <main className="flex-1 p-8">
        <h2 className="text-3xl font-bold text-white mb-8">Settings</h2>
        <div className="bg-gray-900 rounded-lg p-6">
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">Profile</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-green-500 focus:outline-none" 
                    placeholder="Your name" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                  <input 
                    type="email" 
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-green-500 focus:outline-none" 
                    placeholder="your@email.com" 
                  />
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">Preferences</h3>
              <div className="space-y-3">
                <label className="flex items-center">
                  <input type="checkbox" className="mr-3 w-4 h-4 text-green-500 bg-gray-800 border-gray-600 rounded focus:ring-green-500" />
                  <span className="text-gray-300">Email notifications</span>
                </label>
                <label className="flex items-center">
                  <input type="checkbox" className="mr-3 w-4 h-4 text-green-500 bg-gray-800 border-gray-600 rounded focus:ring-green-500" />
                  <span className="text-gray-300">Dark mode</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

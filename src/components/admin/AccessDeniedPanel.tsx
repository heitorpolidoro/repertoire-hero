import Link from "next/link";

/** The "system administrators only" panel the /admin pages answer a non-admin with (HTTP 200). */
export function AccessDeniedPanel() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 space-y-4">
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-3"
      >
        <div className="text-3xl">🚫</div>
        <h2 className="text-lg font-bold text-red-800">Access Denied</h2>
        <p className="text-sm text-red-600">
          You must be a System Administrator to access this page.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
          >
            ← Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}

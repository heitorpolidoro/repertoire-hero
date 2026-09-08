'use client'

import type { SongLinksController } from '@/lib/songLinks'

export interface AddLinkFormProps {
  controller: SongLinksController
}

/**
 * The "Add New Link" form: an optional label (auto-fetched when left blank) and
 * the required url.
 *
 * Presentational only — the two inputs, the duplicate check and the write
 * belong to `useSongLinks`. The form's `preventDefault` stays here, so the
 * controller's `submit` is DOM-free (RH-52).
 */
export function AddLinkForm({ controller }: AddLinkFormProps) {
  if (!controller.isAdding) return null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        controller.submit()
      }}
      className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 shadow-sm"
    >
      <h3 className="text-xs font-semibold text-gray-700">Add New Link</h3>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Link Label (optional - auto-fetched if blank)"
          value={controller.label}
          onChange={(e) => controller.setLabel(e.target.value)}
          className="px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        />
        <input
          type="url"
          placeholder="Link URL (https://...)"
          value={controller.url}
          onChange={(e) => controller.setUrl(e.target.value)}
          required
          className="px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={controller.cancelAdding}
          className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={controller.saving}
          className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {controller.saving ? 'Saving...' : 'Add'}
        </button>
      </div>
    </form>
  )
}

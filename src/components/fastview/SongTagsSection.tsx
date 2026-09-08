'use client'

export interface SongTagsSectionProps {
  tags: string[]
}

/** The "Tags" section: one chip per tag, and nothing at all when there are none. */
export function SongTagsSection({ tags }: SongTagsSectionProps) {
  if (tags.length === 0) return null

  return (
    <section aria-label="Tags">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Tags</h2>
      <ul className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li
            key={tag}
            className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm"
          >
            {tag}
          </li>
        ))}
      </ul>
    </section>
  )
}

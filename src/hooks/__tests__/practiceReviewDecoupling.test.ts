/**
 * RH-169 - the practice review list and its controller take plain rows: neither
 * may depend on the playlist page, its panel state or anything under src/app.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const FILES = ['src/components/ui/PracticeReviewList.tsx', 'src/hooks/usePracticeReview.ts']

describe.each(FILES)('%s', file => {
  const source = readFileSync(join(ROOT, file), 'utf8')

  it('does not mention PlaylistSong or playlistPanels', () => {
    expect(source).not.toMatch(/PlaylistSong/)
    expect(source).not.toMatch(/playlistPanels/)
  })

  it('imports nothing from @/app', () => {
    expect(source).not.toMatch(/from\s+['"]@\/app/)
  })
})

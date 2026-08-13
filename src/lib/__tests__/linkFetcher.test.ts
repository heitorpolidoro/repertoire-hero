import { describe, it, expect, vi } from 'vitest'
import { fetchUrlTitle } from '../linkFetcher'

describe('linkFetcher', () => {
  it('returns fallback hostname for invalid or network-blocked URLs', async () => {
    const title = await fetchUrlTitle('https://example.com/invalid-page-12345')
    expect(typeof title).toBe('string')
  })

  it('parses fallback for unparseable input', async () => {
    const title = await fetchUrlTitle('not-a-valid-url')
    expect(title).toBe('not-a-valid-url')
  })
})

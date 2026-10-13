import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ANDROID = resolve(__dirname, '../../../android')
const listing = readFileSync(resolve(ANDROID, 'listing.md'), 'utf8')
const readme = readFileSync(resolve(ANDROID, 'README.md'), 'utf8')

/** Body of a `## <heading>` section, up to the next `## ` heading. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  expect(start, `missing "## ${heading}"`).toBeGreaterThanOrEqual(0)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

describe('Play listing copy (RH-160)', () => {
  it('has a short description of at most 80 characters', () => {
    const short = section(listing, 'Short description')
    expect(short.length).toBeGreaterThan(0)
    expect(short.length).toBeLessThanOrEqual(80)
  })

  it('has a full description of at most 4000 characters', () => {
    const full = section(listing, 'Full description')
    expect(full.length).toBeGreaterThan(0)
    expect(full.length).toBeLessThanOrEqual(4000)
  })

  it('names the privacy policy URL', () => {
    expect(listing).toContain('https://repertoire-hero.vercel.app/privacy')
  })
})

describe('android/README.md release checklist (RH-160)', () => {
  it('explains why this is not a thin wrapper, naming the four substantive features', () => {
    const body = section(readme, 'Why this is not a thin wrapper')
    expect(body).toMatch(/offline repertoire/i)
    expect(body).toMatch(/Fast View/)
    expect(body).toMatch(/PDF tablature/i)
    expect(body).toMatch(/Stage Mode/)
    expect(body).toMatch(/setlist navigation/i)
    expect(body).toMatch(/band shared repertoires/i)
  })

  it('marks values still to be replaced with PLACEHOLDER and pins the package id forever', () => {
    expect(readme).toContain('PLACEHOLDER')
    expect(readme).toMatch(/can never change/i)
  })
})

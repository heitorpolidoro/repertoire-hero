import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import webManifest from '@/app/manifest'

const twa = JSON.parse(
  readFileSync(resolve(__dirname, '../../../android/twa-manifest.json'), 'utf8'),
)
const web = webManifest()

describe('Bubblewrap manifest parity with the web manifest (RH-160)', () => {
  it('agrees on name and short name', () => {
    expect(twa.name).toBe(web.name)
    expect(twa.launcherName).toBe(web.short_name)
  })

  it('agrees on colours', () => {
    expect(twa.themeColor).toBe(web.theme_color)
    expect(twa.backgroundColor).toBe(web.background_color)
  })

  it('agrees on start url and display', () => {
    expect(twa.startUrl).toBe(web.start_url)
    expect(twa.display).toBe(web.display)
  })

  it('points at the production host and ignored signing material', () => {
    expect(twa.host).toBe('repertoire-hero.vercel.app')
    expect(twa.signingKey.path).toMatch(/\.keystore$/)
  })
})

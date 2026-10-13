import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

interface AssetLinkStatement {
  relation: string[]
  target: {
    namespace: string
    package_name: string
    sha256_cert_fingerprints: string[]
  }
}

const statements: AssetLinkStatement[] = JSON.parse(
  readFileSync(resolve(ROOT, 'public/.well-known/assetlinks.json'), 'utf8'),
)
const twaManifest = JSON.parse(readFileSync(resolve(ROOT, 'android/twa-manifest.json'), 'utf8'))

describe('Digital Asset Links file (RH-160)', () => {
  it('declares exactly one statement with the handle_all_urls relation', () => {
    expect(statements).toHaveLength(1)
    expect(statements[0].relation).toEqual(['delegate_permission/common.handle_all_urls'])
  })

  it('targets an android_app whose package id equals the Bubblewrap manifest', () => {
    expect(statements[0].target.namespace).toBe('android_app')
    expect(statements[0].target.package_name).toBe(twaManifest.packageId)
    expect(twaManifest.packageId).toBe('app.repertoirehero.twa')
  })

  it('carries at least one well-formed SHA-256 fingerprint', () => {
    const fingerprints = statements[0].target.sha256_cert_fingerprints
    expect(fingerprints.length).toBeGreaterThanOrEqual(1)
    for (const fingerprint of fingerprints) {
      expect(fingerprint).toMatch(FINGERPRINT)
    }
  })
})

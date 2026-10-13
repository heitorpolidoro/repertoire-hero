import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as proxyConfig } from '../../proxy'

const ROOT = resolve(__dirname, '../../..')
const SECRET_PATTERNS = ['*.keystore', '*.jks', '*.aab', '*.apk']

describe('TWA signing material and build artifacts stay out of git (RH-160)', () => {
  it('tracks no keystore, jks, aab or apk file', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((file) => /\.(keystore|jks|aab|apk)$/i.test(file))
    expect(tracked).toEqual([])
  })

  it('lists all four patterns in .gitignore', () => {
    const lines = readFileSync(resolve(ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
    for (const pattern of SECRET_PATTERNS) {
      expect(lines, pattern).toContain(pattern)
    }
  })
})

describe('public TWA routes bypass the proxy (RH-160)', () => {
  it('does not match /privacy or /.well-known/assetlinks.json', () => {
    const patterns = proxyConfig.matcher.map((entry) => new RegExp(`^${entry}$`))
    for (const path of ['/privacy', '/.well-known/assetlinks.json']) {
      expect(patterns.some((pattern) => pattern.test(path)), path).toBe(false)
    }
  })
})

import { describe, it, expect } from 'vitest'
import en from '@/i18n/dictionaries/en.json'
import ptBR from '@/i18n/dictionaries/pt-BR.json'

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
interface JsonObject {
  [key: string]: JsonValue
}

/** Flattens a nested dictionary object into sorted dotted leaf paths. */
const flattenKeys = (value: JsonValue, prefix = ''): string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key)
  )
}

/** Collects every string value under `landing.*` for a dictionary. */
const landingStrings = (dict: { landing: Record<string, unknown> }): string[] =>
  Object.values(dict.landing).filter((value): value is string => typeof value === 'string')

const FORBIDDEN_LANDING_COPY = /moderat|moderaç|aprovaç|approval|corrig|correct/i

describe('landing copy', () => {
  it('both dictionaries expose the same key set', () => {
    const enKeys = flattenKeys(en as unknown as JsonValue).sort((a, b) => a.localeCompare(b))
    const ptKeys = flattenKeys(ptBR as unknown as JsonValue).sort((a, b) => a.localeCompare(b))

    expect(enKeys).toEqual(ptKeys)
  })

  it('EN f5 card sells handwritten annotations in Stage Mode', () => {
    expect(en.landing.f5Title).toMatch(/handwritten/i)
    expect(en.landing.f5Title).toMatch(/pdf/i)

    for (const term of ['annotat', 'draw', 'tablet', 'pen', 'finger', 'stage mode']) {
      expect(en.landing.f5Desc).toMatch(new RegExp(term, 'i'))
    }
  })

  it('PT f5 card sells handwritten annotations in Stage Mode', () => {
    expect(ptBR.landing.f5Title).toMatch(/anota[çc]/i)
    expect(ptBR.landing.f5Title).toMatch(/pdf/i)

    for (const term of ['anotaç', 'desenho', 'tablet', 'caneta', 'dedo', 'stage mode']) {
      expect(ptBR.landing.f5Desc).toMatch(new RegExp(term, 'i'))
    }
  })

  it('EN catalog card mentions the shared catalog', () => {
    expect(en.landing.f1Desc).toMatch(/other musicians/i)
    expect(en.landing.f1Desc).toMatch(/pre-filled/i)
  })

  it('PT catalog card mentions the shared catalog', () => {
    expect(ptBR.landing.f1Desc).toMatch(/outros músicos/i)
    expect(ptBR.landing.f1Desc).toMatch(/preenchid/i)
  })

  it('landing copy never mentions moderation or corrections', () => {
    for (const value of [...landingStrings(en), ...landingStrings(ptBR)]) {
      expect(value).not.toMatch(FORBIDDEN_LANDING_COPY)
    }
  })
})

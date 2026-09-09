/**
 * RH-64 — the pure state transitions `useBandAdmin` used to perform inline.
 *
 * Node environment, no mocks: every function here is a plain value-in/value-out
 * transformation, which is exactly why it was worth lifting out of the hook.
 */
import { describe, it, expect } from 'vitest'
import {
  draftFromBand,
  isDraftNameBlank,
  draftToBandUpdate,
  applyBandUpdate,
  withoutMember,
  withInviteCode,
  buildInviteUrl,
  type BandEditDraft,
} from '../bandAdminState'
import { DEFAULT_BAND_COLOR } from '../bandColors'
import type { Band, BandMember } from '@/types/database'

const member = (id: string, userId: string): BandMember => ({
  id,
  band_id: 'band-1',
  user_id: userId,
  role: 'member',
  joined_at: '2026-01-01T00:00:00.000Z',
})

const ME = member('m-1', 'user-1')
const ANA = member('m-2', 'user-2')

const BAND: Band = {
  id: 'band-1',
  name: 'The Band',
  description: 'Loud',
  cover_url: 'https://blob.example/cover.jpg',
  color: '#1d4ed8',
  invite_code: 'INV123',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  members: [ME, ANA],
}

const draft = (overrides: Partial<BandEditDraft> = {}): BandEditDraft => ({
  name: 'The Band',
  description: 'Loud',
  coverPreview: null,
  color: '#1d4ed8',
  ...overrides,
})

describe('draftFromBand', () => {
  it('seeds an edit draft from a loaded band', () => {
    expect(draftFromBand(BAND)).toEqual({
      name: 'The Band',
      description: 'Loud',
      coverPreview: 'https://blob.example/cover.jpg',
      color: '#1d4ed8',
    })
  })

  it('falls back to the default colour and empty strings for a band with null fields', () => {
    expect(draftFromBand({ ...BAND, description: null, cover_url: null, color: null })).toEqual({
      name: 'The Band',
      description: '',
      coverPreview: null,
      color: DEFAULT_BAND_COLOR,
    })
  })

  it('seeds an empty draft from a null band', () => {
    expect(draftFromBand(null)).toEqual({
      name: '',
      description: '',
      coverPreview: null,
      color: DEFAULT_BAND_COLOR,
    })
  })
})

describe('isDraftNameBlank', () => {
  it('reports a whitespace-only draft name as blank', () => {
    expect(isDraftNameBlank(draft({ name: '   ' }))).toBe(true)
    expect(isDraftNameBlank(draft({ name: '' }))).toBe(true)
    expect(isDraftNameBlank(draft({ name: '  The Band  ' }))).toBe(false)
  })
})

describe('draftToBandUpdate', () => {
  it('trims the draft into an update payload and nulls an empty description', () => {
    expect(draftToBandUpdate(draft({ name: '  Renamed  ', description: '  ' }), null)).toEqual({
      name: 'Renamed',
      description: null,
      cover_url: null,
      color: '#1d4ed8',
    })
    expect(
      draftToBandUpdate(draft({ description: '  Louder  ' }), 'https://blob.example/new.jpg'),
    ).toEqual({
      name: 'The Band',
      description: 'Louder',
      cover_url: 'https://blob.example/new.jpg',
      color: '#1d4ed8',
    })
  })
})

describe('applyBandUpdate', () => {
  it('applies an update payload to a band without touching its other fields', () => {
    const updated = applyBandUpdate(BAND, {
      name: 'Renamed',
      description: null,
      cover_url: null,
      color: '#047857',
    })

    expect(updated).toEqual({
      ...BAND,
      name: 'Renamed',
      description: null,
      cover_url: null,
      color: '#047857',
    })
    expect(updated.id).toBe(BAND.id)
    expect(updated.invite_code).toBe('INV123')
    expect(updated.members).toEqual([ME, ANA])
    expect(BAND.name).toBe('The Band')
  })
})

describe('withoutMember', () => {
  it('drops one member from a band and leaves the rest', () => {
    expect(withoutMember(BAND, ANA.id).members).toEqual([ME])
    expect(BAND.members).toEqual([ME, ANA])
  })

  it('returns the band unchanged when no member matches', () => {
    expect(withoutMember(BAND, 'nobody')).toEqual(BAND)
    expect(withoutMember({ ...BAND, members: undefined }, 'nobody').members).toBeUndefined()
  })
})

describe('withInviteCode', () => {
  it('replaces the invite code on a band', () => {
    expect(withInviteCode(BAND, 'NEWCODE')).toEqual({ ...BAND, invite_code: 'NEWCODE' })
    expect(BAND.invite_code).toBe('INV123')
  })
})

describe('buildInviteUrl', () => {
  it('builds an invite url from an origin and an invite code', () => {
    expect(buildInviteUrl('https://app.example', 'INV123')).toBe('https://app.example/join/INV123')
  })

  it('builds an invite url with an empty code when the band has none', () => {
    expect(buildInviteUrl('https://app.example', null)).toBe('https://app.example/join/')
    expect(buildInviteUrl('https://app.example', undefined)).toBe('https://app.example/join/')
  })
})

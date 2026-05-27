import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient as createOriginalClient } from '@supabase/supabase-js'
import { vi } from 'vitest'
import {
  getBands,
  getBandWithMembers,
  createBand,
  updateBand,
  deleteBand,
  leaveBand,
  removeBandMember,
  getBandPlaylists,
  createBandPlaylist,
  joinBandByInviteClient,
  getBandMembers
} from '../bands'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const skip = !SERVICE_ROLE_KEY || !ANON_KEY

const testClient = createOriginalClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => testClient
}))

describe.skipIf(skip)('bands integration tests', () => {
  const admin = createOriginalClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const suffix = Date.now()
  const USER_A = { email: `test-band-a-${suffix}@example.com`, password: 'password123' }
  const USER_B = { email: `test-band-b-${suffix}@example.com`, password: 'password123' }

  let userAId: string
  let userBId: string
  let bandId: string
  let inviteCode: string
  let playlistId: string

  beforeAll(async () => {
    // Create User A
    const { data: { user: userA }, error: errA } = await admin.auth.admin.createUser({
      email: USER_A.email,
      password: USER_A.password,
      email_confirm: true,
    })
    expect(errA).toBeNull()
    userAId = userA!.id

    // Create User B
    const { data: { user: userB }, error: errB } = await admin.auth.admin.createUser({
      email: USER_B.email,
      password: USER_B.password,
      email_confirm: true,
    })
    expect(errB).toBeNull()
    userBId = userB!.id
  })

  afterAll(async () => {
    await testClient.auth.signOut()
    if (userAId) await admin.auth.admin.deleteUser(userAId)
    if (userBId) await admin.auth.admin.deleteUser(userBId)
  })

  it('should allow User A to create a band', async () => {
    // Sign in as User A
    const { error: signInError } = await testClient.auth.signInWithPassword(USER_A)
    expect(signInError).toBeNull()

    bandId = await createBand(`Test Band ${suffix}`, 'A cool test band', 'https://example.com/cover.jpg')
    expect(bandId).toBeDefined()
    expect(typeof bandId).toBe('string')
  })

  it('should allow User A to get their bands', async () => {
    const bands = await getBands()
    expect(bands).toBeDefined()
    expect(Array.isArray(bands)).toBe(true)
    expect(bands.some((b) => b.id === bandId)).toBe(true)
  })

  it('should allow User A to get band with members', async () => {
    const band = await getBandWithMembers(bandId)
    expect(band).not.toBeNull()
    expect(band!.name).toBe(`Test Band ${suffix}`)
    expect(band!.invite_code).toBeDefined()
    inviteCode = band!.invite_code

    const members = (band as any).members
    expect(members).toBeDefined()
    expect(members.length).toBe(1)
    expect(members[0].user_id).toBe(userAId)
    expect(members[0].role).toBe('admin')
  })

  it('should allow User B to join the band by invite code', async () => {
    // Sign in as User B
    const { error: signInError } = await testClient.auth.signInWithPassword(USER_B)
    expect(signInError).toBeNull()

    const joinedBandId = await joinBandByInviteClient(inviteCode)
    expect(joinedBandId).toBe(bandId)
  })

  it('should show User B as a member when fetching the band', async () => {
    const band = await getBandWithMembers(bandId)
    expect(band).not.toBeNull()

    const members = (band as any).members
    expect(members.length).toBe(2)

    const memberB = members.find((m: any) => m.user_id === userBId)
    expect(memberB).toBeDefined()
    expect(memberB.role).toBe('member')
  })

  it('should allow User B to create a band playlist and fetch band playlists', async () => {
    playlistId = await createBandPlaylist(bandId, 'Rock Anthems')
    expect(playlistId).toBeDefined()

    const playlists = await getBandPlaylists(bandId)
    expect(playlists).toBeDefined()
    expect(playlists.some((p) => p.id === playlistId)).toBe(true)
  })

  it('should prevent User B (non-admin) from updating the band', async () => {
    // Sign in as User B
    const { error: signInB } = await testClient.auth.signInWithPassword(USER_B)
    expect(signInB).toBeNull()

    // Attempts to update. Postgres/Supabase RLS allows the query but updates 0 rows without throwing an error.
    await updateBand(bandId, { name: 'New Name By B' })

    // Sign back in as User A to verify the name did not change
    const { error: signInA } = await testClient.auth.signInWithPassword(USER_A)
    expect(signInA).toBeNull()

    const band = await getBandWithMembers(bandId)
    expect(band!.name).not.toBe('New Name By B')
  })

  it('should allow User A (admin) to update the band', async () => {
    // Sign in as User A
    const { error: signInError } = await testClient.auth.signInWithPassword(USER_A)
    expect(signInError).toBeNull()

    await updateBand(bandId, { name: `Updated Name ${suffix}` })

    const band = await getBandWithMembers(bandId)
    expect(band!.name).toBe(`Updated Name ${suffix}`)
  })

  it('should allow User A (admin) to remove User B from the band', async () => {
    // Sign in as User A to perform and verify this
    const { error: signInA } = await testClient.auth.signInWithPassword(USER_A)
    expect(signInA).toBeNull()

    const bandBefore = await getBandWithMembers(bandId)
    const membersBefore = (bandBefore as any).members
    const memberB = membersBefore.find((m: any) => m.user_id === userBId)
    expect(memberB).toBeDefined()

    await removeBandMember(memberB.id)

    const bandAfter = await getBandWithMembers(bandId)
    const membersAfter = (bandAfter as any).members
    expect(membersAfter.length).toBe(1)
    expect(membersAfter.some((m: any) => m.user_id === userBId)).toBe(false)
  })

  it('should allow a member to leave the band', async () => {
    // Sign in as User B to join again
    const { error: signInB } = await testClient.auth.signInWithPassword(USER_B)
    expect(signInB).toBeNull()

    const joinedBandId = await joinBandByInviteClient(inviteCode)
    expect(joinedBandId).toBe(bandId)

    // Sign in as User A to verify B has joined
    const { error: signInA } = await testClient.auth.signInWithPassword(USER_A)
    expect(signInA).toBeNull()

    const bandBefore = await getBandWithMembers(bandId)
    expect((bandBefore as any).members.length).toBe(2)

    // Sign back in as User B to leave the band
    const { error: signInB2 } = await testClient.auth.signInWithPassword(USER_B)
    expect(signInB2).toBeNull()

    // Leave the band
    await leaveBand(bandId, userBId)

    // Sign back in as User A to verify B has left (since B no longer has select access to the band)
    const { error: signInA2 } = await testClient.auth.signInWithPassword(USER_A)
    expect(signInA2).toBeNull()

    const bandAfter = await getBandWithMembers(bandId)
    const membersAfter = (bandAfter as any).members
    expect(membersAfter.length).toBe(1)
    expect(membersAfter.some((m: any) => m.user_id === userBId)).toBe(false)
  })

  it('should allow User A (creator) to delete the band', async () => {
    // Sign in as User A
    const { error: signInError } = await testClient.auth.signInWithPassword(USER_A)
    expect(signInError).toBeNull()

    await deleteBand(bandId)

    const band = await getBandWithMembers(bandId)
    expect(band).toBeNull()
  })

  it('getBandMembers returns members when defined and empty array when undefined', () => {
    const bandWithMembers = { id: '1', name: 'Band', members: [{ id: 'm1' }] } as any
    const bandWithoutMembers = { id: '2', name: 'Band' } as any
    expect(getBandMembers(bandWithMembers)).toEqual([{ id: 'm1' }])
    expect(getBandMembers(bandWithoutMembers)).toEqual([])
  })
})


/**
 * RH-186 - custom fields against a real Postgres.
 *
 * Fixture: user A (band admin) and user B (plain member of A's band), one song
 * with two versions that nobody holds - no `user_songs`, no `band_songs` row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createBand } from '@/lib/bands'
import {
  createCustomField,
  deleteCustomField,
  getCustomFieldValues,
  listCustomFields,
  moveCustomField,
  renameCustomField,
  setCustomFieldValue,
} from '@/lib/customFields'
import {
  CUSTOM_FIELD_DUPLICATE_MESSAGE,
  CUSTOM_FIELD_NAME_MESSAGE,
  CUSTOM_FIELD_NOT_FOUND_MESSAGE,
  CUSTOM_FIELD_VALUE_MESSAGE,
} from '@/lib/customFieldRules'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('custom fields (real database)', () => {
  const suffix = Date.now()
  let userA: string
  let userB: string
  let bandId: string
  let songId: string
  let v1: string
  let v2: string

  const insertId = async (sql: string, params: unknown[]): Promise<string> =>
    (await query<{ id: string }>(sql, params)).rows[0].id

  const valueRows = async (fieldId: string): Promise<Array<{ user_id: string; version_id: string; value: string }>> =>
    (
      await query<{ user_id: string; version_id: string; value: string }>(
        'SELECT user_id, version_id, value FROM custom_field_values WHERE field_id = $1',
        [fieldId],
      )
    ).rows

  const names = async (userId: string): Promise<string[]> => (await listCustomFields(userId)).map((f) => f.name)

  const clearFields = async (userId: string): Promise<void> => {
    await query('DELETE FROM custom_fields WHERE owner_user_id = $1', [userId])
  }

  beforeAll(async () => {
    userA = await createTestUser({ email: `rh186-a-${suffix}@example.com` })
    userB = await createTestUser({ email: `rh186-b-${suffix}@example.com` })
    bandId = await createBand(userA, `RH-186 Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [bandId, userB])
    songId = await insertId('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
      `RH-186 Song ${suffix}`,
      `RH-186 Artist ${suffix}`,
    ])
    v1 = await insertId('INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id', [songId, 'studio'])
    v2 = await insertId('INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id', [songId, 'live'])
  })

  afterAll(async () => {
    await query('DELETE FROM songs WHERE id = $1', [songId])
    await query('DELETE FROM bands WHERE id = $1', [bandId])
    await deleteTestUser(userA)
    await deleteTestUser(userB)
  })

  describe('definitions', () => {
    it('creates at the end, renames, moves and lists in saved order (ER1)', async () => {
      await clearFields(userA)
      await createCustomField(userA, ' Preset ')
      const amp = await createCustomField(userA, 'Amp')
      expect(await names(userA)).toEqual(['Preset', 'Amp'])

      await renameCustomField(userA, amp.id, 'Pedal')
      await moveCustomField(userA, amp.id, 'up')
      expect(await names(userA)).toEqual(['Pedal', 'Preset'])
    })

    it('treats a move past either end as a no-op', async () => {
      await clearFields(userA)
      const first = await createCustomField(userA, 'First')
      const last = await createCustomField(userA, 'Last')
      await moveCustomField(userA, first.id, 'up')
      await moveCustomField(userA, last.id, 'down')
      expect(await names(userA)).toEqual(['First', 'Last'])
      await moveCustomField(userA, first.id, 'down')
      expect(await names(userA)).toEqual(['Last', 'First'])
    })

    it('refuses a case-insensitive duplicate for the same user, allows it for another (ER2)', async () => {
      await clearFields(userA)
      await clearFields(userB)
      await createCustomField(userA, 'Preset')
      await expect(createCustomField(userA, 'preset')).rejects.toThrow(CUSTOM_FIELD_DUPLICATE_MESSAGE)
      const other = await createCustomField(userB, 'Preset')
      expect(other.name).toBe('Preset')
      expect(await names(userA)).toEqual(['Preset'])
    })

    it('refuses a rename onto another field of the same user, allows a case-only rename of its own', async () => {
      await clearFields(userA)
      const preset = await createCustomField(userA, 'Preset')
      const amp = await createCustomField(userA, 'Amp')
      await expect(renameCustomField(userA, amp.id, 'PRESET')).rejects.toThrow(CUSTOM_FIELD_DUPLICATE_MESSAGE)
      const renamed = await renameCustomField(userA, preset.id, 'preset')
      expect(renamed.name).toBe('preset')
    })

    it('refuses an invalid name before writing', async () => {
      await clearFields(userA)
      await expect(createCustomField(userA, '   ')).rejects.toThrow(CUSTOM_FIELD_NAME_MESSAGE)
      const field = await createCustomField(userA, 'Preset')
      await expect(renameCustomField(userA, field.id, 'x'.repeat(41))).rejects.toThrow(CUSTOM_FIELD_NAME_MESSAGE)
      expect(await names(userA)).toEqual(['Preset'])
    })

    it('delete cascades every value of the field (ER3)', async () => {
      await clearFields(userA)
      const field = await createCustomField(userA, 'Preset')
      await setCustomFieldValue(userA, field.id, v1, 'Lead 3B')
      await setCustomFieldValue(userA, field.id, v2, 'Clean 1A')
      expect(await valueRows(field.id)).toHaveLength(2)
      await deleteCustomField(userA, field.id)
      expect(await valueRows(field.id)).toHaveLength(0)
      expect(await names(userA)).toEqual([])
    })
  })

  describe('values', () => {
    it('is per user and per version, Not set (null) everywhere else (ER4)', async () => {
      await clearFields(userA)
      await clearFields(userB)
      const preset = await createCustomField(userA, 'Preset')
      const saved = await setCustomFieldValue(userA, preset.id, v1, '  Lead 3B ')
      expect(saved).toBe('Lead 3B')
      expect(await getCustomFieldValues(userA, v1)).toEqual([{ fieldId: preset.id, name: 'Preset', value: 'Lead 3B' }])
      expect(await getCustomFieldValues(userA, v2)).toEqual([{ fieldId: preset.id, name: 'Preset', value: null }])
    })

    it('lists every definition in order, each with its own value or null', async () => {
      await clearFields(userA)
      const preset = await createCustomField(userA, 'Preset')
      const capo = await createCustomField(userA, 'Capo')
      await setCustomFieldValue(userA, capo.id, v1, '2')
      expect(await getCustomFieldValues(userA, v1)).toEqual([
        { fieldId: preset.id, name: 'Preset', value: null },
        { fieldId: capo.id, name: 'Capo', value: '2' },
      ])
    })

    it('a blank set deletes the row instead of storing an empty string (ER5)', async () => {
      await clearFields(userA)
      const preset = await createCustomField(userA, 'Preset')
      await setCustomFieldValue(userA, preset.id, v1, 'Lead 3B')
      expect(await setCustomFieldValue(userA, preset.id, v1, '   ')).toBeNull()
      expect(await valueRows(preset.id)).toEqual([])
      expect((await getCustomFieldValues(userA, v1))[0].value).toBeNull()
    })

    it('a blank set with no value yet is a no-op on an owned field', async () => {
      await clearFields(userA)
      const preset = await createCustomField(userA, 'Preset')
      expect(await setCustomFieldValue(userA, preset.id, v2, '')).toBeNull()
      expect(await valueRows(preset.id)).toEqual([])
    })

    it('updates an existing value in place', async () => {
      await clearFields(userA)
      const preset = await createCustomField(userA, 'Preset')
      await setCustomFieldValue(userA, preset.id, v1, 'Lead 3B')
      await setCustomFieldValue(userA, preset.id, v1, 'Lead 4A')
      expect(await valueRows(preset.id)).toEqual([{ user_id: userA, version_id: v1, value: 'Lead 4A' }])
    })

    it('refuses a value over 200 characters', async () => {
      await clearFields(userA)
      const preset = await createCustomField(userA, 'Preset')
      await expect(setCustomFieldValue(userA, preset.id, v1, 'v'.repeat(201))).rejects.toThrow(
        CUSTOM_FIELD_VALUE_MESSAGE,
      )
    })

    it('the database refuses a blank value written around the lib', async () => {
      await clearFields(userA)
      const preset = await createCustomField(userA, 'Preset')
      await expect(
        query('INSERT INTO custom_field_values (field_id, user_id, version_id, value) VALUES ($1, $2, $3, $4)', [
          preset.id,
          userA,
          v1,
          '  ',
        ]),
      ).rejects.toThrow(/custom_field_values_value_not_blank/)
    })

    it('a plain band member sets a value on an unheld version and creates no repertoire row (ER6)', async () => {
      await clearFields(userB)
      const preset = await createCustomField(userB, 'Preset')
      await setCustomFieldValue(userB, preset.id, v2, 'Lead 3B')
      const userSongs = await query<{ n: number }>(
        'SELECT count(*)::int AS n FROM user_songs WHERE version_id = ANY($1::uuid[])',
        [[v1, v2]],
      )
      const bandSongs = await query<{ n: number }>(
        'SELECT count(*)::int AS n FROM band_songs WHERE band_id = $1 OR version_id = ANY($2::uuid[])',
        [bandId, [v1, v2]],
      )
      expect(userSongs.rows[0].n).toBe(0)
      expect(bandSongs.rows[0].n).toBe(0)
      expect(await getCustomFieldValues(userB, v2)).toEqual([{ fieldId: preset.id, name: 'Preset', value: 'Lead 3B' }])
    })
  })

  describe("another user's field (ER7)", () => {
    it('every call by B on A\'s field id affects zero rows and throws Custom field not found', async () => {
      await clearFields(userA)
      await clearFields(userB)
      const first = await createCustomField(userA, 'Preset')
      const second = await createCustomField(userA, 'Amp')
      await setCustomFieldValue(userA, first.id, v1, 'Lead 3B')

      await expect(renameCustomField(userB, first.id, 'Hijacked')).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
      await expect(moveCustomField(userB, second.id, 'up')).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
      await expect(deleteCustomField(userB, first.id)).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
      await expect(setCustomFieldValue(userB, first.id, v1, 'Mine')).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
      await expect(setCustomFieldValue(userB, first.id, v1, '')).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)

      expect(await names(userA)).toEqual(['Preset', 'Amp'])
      expect(await valueRows(first.id)).toEqual([{ user_id: userA, version_id: v1, value: 'Lead 3B' }])
      expect(await getCustomFieldValues(userB, v1)).toEqual([])
      expect(await listCustomFields(userB)).toEqual([])
    })

    it('a field id that does not exist throws Custom field not found', async () => {
      const missing = '00000000-0000-0000-0000-000000000000'
      await expect(renameCustomField(userA, missing, 'X')).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
      await expect(moveCustomField(userA, missing, 'down')).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
      await expect(deleteCustomField(userA, missing)).rejects.toThrow(CUSTOM_FIELD_NOT_FOUND_MESSAGE)
    })

    it('wraps a database failure in the L1 message', async () => {
      await expect(getCustomFieldValues(userA, 'not-a-uuid')).rejects.toThrow(/^Failed to load custom field values: /)
    })
  })
})

/** RH-186 - the shared limits and normalisation of custom field names and values. */
import { describe, it, expect } from 'vitest'
import {
  CUSTOM_FIELD_DUPLICATE_MESSAGE,
  CUSTOM_FIELD_NAME_MESSAGE,
  CUSTOM_FIELD_NOT_FOUND_MESSAGE,
  CUSTOM_FIELD_VALUE_MESSAGE,
  normalizeCustomFieldName,
  normalizeCustomFieldValue,
} from '@/lib/customFieldRules'

describe('normalizeCustomFieldName', () => {
  it('trims the name', () => {
    expect(normalizeCustomFieldName('  Preset  ')).toBe('Preset')
  })

  it('accepts 1 and 40 characters', () => {
    expect(normalizeCustomFieldName('a')).toBe('a')
    expect(normalizeCustomFieldName('x'.repeat(40))).toBe('x'.repeat(40))
  })

  it('refuses a blank name and one over 40 characters with the name message', () => {
    expect(() => normalizeCustomFieldName('   ')).toThrow(CUSTOM_FIELD_NAME_MESSAGE)
    expect(() => normalizeCustomFieldName('x'.repeat(41))).toThrow(CUSTOM_FIELD_NAME_MESSAGE)
  })

  it('counts the length after trimming', () => {
    expect(normalizeCustomFieldName(` ${'x'.repeat(40)} `)).toBe('x'.repeat(40))
  })
})

describe('normalizeCustomFieldValue', () => {
  it('trims the value', () => {
    expect(normalizeCustomFieldValue('  Lead 3B ')).toBe('Lead 3B')
  })

  it('reads a trimmed-empty value as a clear (null)', () => {
    expect(normalizeCustomFieldValue('')).toBeNull()
    expect(normalizeCustomFieldValue('   ')).toBeNull()
  })

  it('accepts 200 characters and refuses 201 with the value message', () => {
    expect(normalizeCustomFieldValue('v'.repeat(200))).toBe('v'.repeat(200))
    expect(() => normalizeCustomFieldValue('v'.repeat(201))).toThrow(CUSTOM_FIELD_VALUE_MESSAGE)
  })
})

describe('the user-facing messages', () => {
  it('are verbatim', () => {
    expect(CUSTOM_FIELD_DUPLICATE_MESSAGE).toBe('You already have a field with that name.')
    expect(CUSTOM_FIELD_NAME_MESSAGE).toBe('Field name must be 1 to 40 characters.')
    expect(CUSTOM_FIELD_VALUE_MESSAGE).toBe('Value must be at most 200 characters.')
    expect(CUSTOM_FIELD_NOT_FOUND_MESSAGE).toBe('Custom field not found')
  })
})

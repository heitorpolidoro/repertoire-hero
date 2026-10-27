/**
 * RH-186 - the rules a custom field name and value obey on both sides of the
 * wire. Pure and client-safe: the Settings form and the Fast View editor read
 * the same limits the data layer enforces.
 */

export const CUSTOM_FIELD_NAME_MAX = 40
export const CUSTOM_FIELD_VALUE_MAX = 200

export const CUSTOM_FIELD_DUPLICATE_MESSAGE = 'You already have a field with that name.'
export const CUSTOM_FIELD_NAME_MESSAGE = `Field name must be 1 to ${CUSTOM_FIELD_NAME_MAX} characters.`
export const CUSTOM_FIELD_VALUE_MESSAGE = `Value must be at most ${CUSTOM_FIELD_VALUE_MAX} characters.`
export const CUSTOM_FIELD_NOT_FOUND_MESSAGE = 'Custom field not found'

/** The trimmed name, or throws the name message when it is not 1 to 40 characters. */
export function normalizeCustomFieldName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > CUSTOM_FIELD_NAME_MAX) {
    throw new Error(CUSTOM_FIELD_NAME_MESSAGE)
  }
  return trimmed
}

/**
 * The trimmed value, or `null` when it is blank - a blank save is a clear, so an
 * empty string is never stored. Throws the value message past 200 characters.
 */
export function normalizeCustomFieldValue(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.length > CUSTOM_FIELD_VALUE_MAX) throw new Error(CUSTOM_FIELD_VALUE_MESSAGE)
  return trimmed
}

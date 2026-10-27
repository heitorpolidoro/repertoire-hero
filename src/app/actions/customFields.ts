'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  createCustomField,
  deleteCustomField,
  getCustomFieldValues,
  listCustomFields,
  moveCustomField,
  renameCustomField,
  setCustomFieldValue,
  type CustomFieldMoveDirection,
} from '@/lib/customFields'
import type { CustomField, CustomFieldEntry } from '@/types/customField'

/*
 * RH-186 - a user's own custom fields. Thin (A2): each action resolves the
 * session and delegates; no user id and no band id is taken from the client,
 * because a definition and a value always belong to the signed-in user.
 */

export async function listCustomFieldsAction(): Promise<CustomField[]> {
  const userId = await getRequiredUserId()
  return listCustomFields(userId)
}

export async function createCustomFieldAction(name: string): Promise<CustomField> {
  const userId = await getRequiredUserId()
  return createCustomField(userId, name)
}

export async function renameCustomFieldAction(fieldId: string, name: string): Promise<CustomField> {
  const userId = await getRequiredUserId()
  return renameCustomField(userId, fieldId, name)
}

export async function moveCustomFieldAction(fieldId: string, direction: CustomFieldMoveDirection): Promise<void> {
  const userId = await getRequiredUserId()
  return moveCustomField(userId, fieldId, direction)
}

export async function deleteCustomFieldAction(fieldId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return deleteCustomField(userId, fieldId)
}

export async function getCustomFieldValuesAction(versionId: string): Promise<CustomFieldEntry[]> {
  const userId = await getRequiredUserId()
  return getCustomFieldValues(userId, versionId)
}

export async function setCustomFieldValueAction(
  fieldId: string,
  versionId: string,
  value: string,
): Promise<string | null> {
  const userId = await getRequiredUserId()
  return setCustomFieldValue(userId, fieldId, versionId, value)
}

import {
  createCustomFieldAction,
  deleteCustomFieldAction,
  getCustomFieldValuesAction,
  listCustomFieldsAction,
  moveCustomFieldAction,
  renameCustomFieldAction,
  setCustomFieldValueAction,
} from '@/app/actions/customFields'
import type { CustomFieldSettingsActions } from '@/hooks/useCustomFieldSettings'
import type { SongCustomFieldsActions } from '@/hooks/useSongCustomFields'

/**
 * The custom field Server Actions (RH-186), bundled for injection (F21).
 * Module-level so the object identities are stable.
 *
 * The keys are the action names without the suffix, and they are load-bearing:
 * `offlineFirst` classifies a method by its bundle key, so `getCustomFieldValues`
 * is answered from the snapshot offline and `setCustomFieldValue`, matching no
 * reader, is refused as a write.
 */
export const CUSTOM_FIELD_SETTINGS_ACTIONS: CustomFieldSettingsActions = {
  listCustomFields: listCustomFieldsAction,
  createCustomField: createCustomFieldAction,
  renameCustomField: renameCustomFieldAction,
  moveCustomField: moveCustomFieldAction,
  deleteCustomField: deleteCustomFieldAction,
}

export const SONG_CUSTOM_FIELDS_ACTIONS: SongCustomFieldsActions = {
  getCustomFieldValues: getCustomFieldValuesAction,
  setCustomFieldValue: setCustomFieldValueAction,
}

/**
 * A user's own custom field definitions and their values on one version (RH-186).
 *
 * Kept beside `database.ts` rather than in it: that file sits at the global
 * `max-lines` of 400, which the complexity ratchet forbids raising.
 */

/** One definition, as its owner's Settings list shows it. */
export interface CustomField {
  id: string;
  name: string;
  /** Only the order is meaningful; gaps left by a delete are harmless. */
  position: number;
}

/** One definition of the reader's, with the reader's value on one version. */
export interface CustomFieldEntry {
  fieldId: string;
  name: string;
  /** `null` is "Not set": there is no row, never an empty string. */
  value: string | null;
}

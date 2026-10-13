/**
 * One pending suggestion about one `song_links` row, with that row as it stands
 * (RH-138): the entries of `PendingCatalogSuggestionGroup.link_changes`.
 *
 * Kept beside `database.ts` rather than in it: that file sits at the global
 * `max-lines` of 400, which the complexity ratchet forbids raising.
 */
export interface PendingLinkChange {
  /** The `catalog_suggestions.id` the admin's verdict is recorded against. */
  suggestion_id: string;
  /** The `song_links.id` the suggestion names. */
  link_id: string;
  column: "url" | "label" | "removed";
  value: unknown;
  /** The link as stored now. */
  current: { url: string; label: string };
}

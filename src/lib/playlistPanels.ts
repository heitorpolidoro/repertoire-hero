/**
 * RH-70 — the panels of `/playlists/[id]`, as one value instead of four flags.
 *
 * The page used to carry `editing`, `editName`, `confirmDelete` and
 * `showSearch` side by side, which made "two panels open at once" a reachable
 * state: a delete confirmation armed and then left by a rename came back armed
 * on Cancel, and the add-song panel stayed open underneath the rename input.
 *
 * Here "at most one panel is open" is a property of the type rather than of the
 * reducer: there is simply no member of `PlaylistPanel` that holds two. The
 * rename draft rides inside the `rename` member, so closing the panel discards
 * it — which is what the page did anyway, by overwriting the draft with the
 * playlist's name on every open.
 */

/** Which panel of the playlist header is open, and what it is holding. */
export type PlaylistPanel =
  | { kind: 'none' }
  | { kind: 'rename'; draft: string }
  | { kind: 'delete-confirm' }
  | { kind: 'picker' }

/** Everything the header can ask of the panel state. */
export type PlaylistPanelAction =
  | { type: 'open-rename'; name: string }
  | { type: 'change-rename-draft'; draft: string }
  | { type: 'open-delete-confirm' }
  | { type: 'toggle-picker' }
  | { type: 'close' }

/** The initial state, so no call site has to spell the literal. */
export const NO_PANEL: PlaylistPanel = { kind: 'none' }

/** Applies one action. Opening a panel closes whichever one was open. */
export function playlistPanelReducer(
  state: PlaylistPanel,
  action: PlaylistPanelAction,
): PlaylistPanel {
  switch (action.type) {
    case 'open-rename':
      return { kind: 'rename', draft: action.name }
    case 'change-rename-draft':
      return state.kind === 'rename' ? { kind: 'rename', draft: action.draft } : state
    case 'open-delete-confirm':
      return { kind: 'delete-confirm' }
    case 'toggle-picker':
      return state.kind === 'picker' ? NO_PANEL : { kind: 'picker' }
    case 'close':
      return NO_PANEL
  }
}

/**
 * What the rename input holds, or `''` when the rename panel is closed. Keeping
 * the narrowing here is what keeps `panel.kind === …` out of the page and out
 * of the header.
 */
export function renameDraft(state: PlaylistPanel): string {
  return state.kind === 'rename' ? state.draft : ''
}

import {
  getBandWithMembersAction,
  getBandPlaylistsAction,
  updateBandAction,
  deleteBandAction,
  leaveBandAction,
  removeBandMemberAction,
  createBandPlaylistAction,
  uploadBandCoverAction,
} from "@/app/actions/bands";
import type { BandAdminActions } from "@/hooks/useBandAdmin";

/**
 * The band Server Actions injected into `useBandAdmin` by `/bands/[id]` and the
 * band tab of `/profile`. Module-level, so the object identity is stable and the
 * hook's `load` effect cannot be restarted by a re-render (RH-47, finding F21).
 */
export const BAND_ADMIN_ACTIONS: BandAdminActions = {
  getBandWithMembers: getBandWithMembersAction,
  getBandPlaylists: getBandPlaylistsAction,
  updateBand: updateBandAction,
  deleteBand: deleteBandAction,
  leaveBand: leaveBandAction,
  removeBandMember: removeBandMemberAction,
  createBandPlaylist: createBandPlaylistAction,
  uploadBandCover: uploadBandCoverAction,
};

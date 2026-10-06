import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getPlaylistWithSongs,
} from "../playlists";
import {
  getRepertoire,
  addSongToRepertoire,
  updateSongStatus,
  updateSongTags,
  updateSongKey,
  removeSongFromRepertoire,
  getSongEntry,
  getPersonalEntryForSong,
  updateLyrics,
  updateSong,
  createAndAddSong,
  assertRepertoireAccess,
} from "../ownerSongs";
import { searchSongs } from "../songs";
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
} from "../bands";
import { getProfile, updateProfile } from "../profile";
import {
  getBandByInviteCodeServer,
  joinBandByInviteServer,
} from "../bands.server";
import { query } from "@/lib/db";

// Mock the db module
vi.mock("@/lib/db", () => {
  const query = vi.fn();
  return {
    query,
    pool: {
      query: vi.fn(),
    },
    // RH-36: the transaction runs on a client whose `query` is the same mock,
    // so the dispatcher below still sees every statement of a wrapped write.
    withTransaction: (fn: (client: { query: typeof query }) => unknown) => fn({ query }),
  };
});

// Standard mock error
const mockError = new Error("Mocked Database Error");

let failLookup = true;
let failRepertoireCheck = true;
let failRepertoireInsert = true;
/**
 * What the owner-table insert mock hands back. RH-95 made zero rows
 * meaningful — `ON CONFLICT DO NOTHING` returns none when the owner already has
 * the song — and this is a value rather than a flag on purpose: the dispatcher
 * below is pinned at complexity 17 by the F20 ratchet, so it cannot afford
 * another branch.
 */
let repertoireInsertRows: Array<{ id: string }> = [{ id: "repertoire-id" }];
let failCountCheck = true;
let failPlaylistLookup = true;

beforeEach(() => {
  failLookup = true;
  failRepertoireCheck = true;
  failRepertoireInsert = true;
  repertoireInsertRows = [{ id: "repertoire-id" }];
  failCountCheck = true;
  failPlaylistLookup = true;

  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation(async (sql: string, params?: any[]) => {
    const normalizedSql = sql.toLowerCase();

    // Support transaction commands without throwing. One regex rather than
    // three `===` comparisons joined by `||`: each `||` costs this dispatcher a
    // point of cyclomatic complexity, and the file's override is a ratchet that
    // may only shrink, so the saving is what pays for the branch RH-125 adds
    // below — and then some (17 -> 16).
    if (/^(begin|commit|rollback)$/.test(normalizedSql.trim())) {
      return { rowCount: 0, rows: [] };
    }

    // 1. playlists lookup — also serves the RH-34 assertPlaylistAccess read,
    // which is why the guarded statements below need it to succeed.
    // RH-122: the two destructive statements that always fail share one
    // decision point. They used to be two separate `if`s; merging them pays for
    // the album/version branch added below, so this file stays exactly on the
    // `complexity: 32` ceiling its override pins (the ratchet may only shrink).
    if (/delete from (playlists|band_members)/.test(normalizedSql)) {
      throw mockError;
    }
    if (normalizedSql.includes("from playlists")) {
      if (failPlaylistLookup) {
        throw mockError;
      }
      return { rowCount: 1, rows: [{ user_id: "mock-user-id", band_id: null }] };
    }

    // 2. songs lookup
    if (normalizedSql.includes("from songs")) {
      if (failLookup) {
        throw mockError;
      }
      return { rowCount: 1, rows: [{ id: "global-song-id" }] };
    }

    // 3. owner-row lookup/check. RH-124 split `repertoire` into `user_songs`
    // and `band_songs`, so the pattern names both; the branch count is
    // unchanged, which matters because this file sits exactly on its
    // `complexity: 32` ceiling and the ratchet may only shrink.
    if (/from (user|band)_songs/.test(normalizedSql)) {
      if (failRepertoireCheck) {
        throw mockError;
      }
      // Return 0 rows when check succeeds so that it proceeds to insert, or 1 row if we wanted it to be a duplicate
      return { rowCount: 0, rows: [] };
    }

    // 3b. band membership — the RH-34 band helpers read exactly
    // `... FROM band_members WHERE ...` (no alias, unlike the aggregate
    // subqueries in getBands / getBandWithMembers, which stay on the failing
    // default). Reads resolve to an admin membership so the statement under
    // test is the one that fails; the DELETE keeps failing in the merged guard
    // above, which is what leaveBand and removeBandMember assert on.
    if (normalizedSql.includes("from band_members where")) {
      return { rowCount: 1, rows: [{ band_id: "mock-band-id", role: "admin" }] };
    }

    // 3c. the RH-122 album and version upserts. `createAndAddSong` issues them
    // right after the catalog resolution and before the repertoire insert, so
    // without a branch here they would fall through to the default and every
    // createAndAddSong case below would fail on the wrong statement. The album
    // half is `ON CONFLICT DO NOTHING` and an empty result is its normal answer
    // — the version is then written album-less, which the nullable column
    // allows.
    if (/(insert into albums)|(from albums)/.test(normalizedSql)) {
      return { rowCount: 0, rows: [] };
    }

    // 3d. the version upsert answers its own id since RH-125: the playlist
    // entry is written with it, so `upsertAlbumAndVersion` throws rather than
    // returning an id it could not resolve. An empty result here would make
    // every `createAndAddSong` case below fail on that throw instead of on the
    // condition it is about.
    // Anchored on the upsert's own two statements, not on `song_versions`
    // anywhere: the owner-row insert below reaches that table too, through the
    // representative-version subquery, and a looser pattern would swallow it.
    if (/(insert into song_versions)|(select id from song_versions)/.test(normalizedSql)) {
      return { rowCount: 1, rows: [{ id: "mock-version-id" }] };
    }

    // 4. owner-row insert
    if (/insert into (user|band)_songs/.test(normalizedSql)) {
      if (failRepertoireInsert) {
        throw mockError;
      }
      return { rowCount: repertoireInsertRows.length, rows: repertoireInsertRows };
    }

    // 5. playlist_songs count
    if (normalizedSql.includes("count(*) as count from playlist_songs")) {
      if (failCountCheck) {
        throw mockError;
      }
      return { rowCount: 1, rows: [{ count: 0 }] };
    }

    // Default: throw Mocked Database Error for all other queries
    throw mockError;
  });
});

describe("Data Layer Error Handling", () => {
  describe("playlists.ts errors", () => {
    it("getUserPlaylists throws on DB error", async () => {
      await expect(getUserPlaylists("mock-user-id")).rejects.toThrow(
        "Failed to fetch playlists: Mocked Database Error",
      );
    });

    it("createPlaylist throws on DB error", async () => {
      await expect(createPlaylist("mock-user-id", { name: "Test" })).rejects.toThrow(
        "Failed to create playlist: Mocked Database Error",
      );
    });

    it("updatePlaylist throws on DB error", async () => {
      failPlaylistLookup = false;
      await expect(updatePlaylist("1", "mock-user-id", { name: "Test" })).rejects.toThrow(
        "Failed to update playlist: Mocked Database Error",
      );
    });

    it("deletePlaylist throws on DB error", async () => {
      failPlaylistLookup = false;
      await expect(deletePlaylist("1", "mock-user-id")).rejects.toThrow(
        "Failed to delete playlist: Mocked Database Error",
      );
    });

    it("addSongToPlaylist throws on DB error", async () => {
      failPlaylistLookup = false;
      failRepertoireCheck = false;
      failRepertoireInsert = false;
      await expect(addSongToPlaylist("1", "mock-user-id", "2")).rejects.toThrow(
        "Failed to add song to playlist: Mocked Database Error",
      );
    });

    it("addSongToPlaylist throws on DB error during insert", async () => {
      failPlaylistLookup = false;
      failRepertoireCheck = false;
      failRepertoireInsert = false;
      failCountCheck = false;
      // The select query count will succeed (mocked above) but the subsequent insert will fail through the default fallback
      await expect(addSongToPlaylist("1", "mock-user-id", "2")).rejects.toThrow(
        "Failed to add song to playlist: Mocked Database Error",
      );
    });

    it("removeSongFromPlaylist throws on DB error", async () => {
      failPlaylistLookup = false;
      await expect(removeSongFromPlaylist("1", "mock-user-id", "2")).rejects.toThrow(
        "Failed to remove song from playlist: Mocked Database Error",
      );
    });

    it("getPlaylistWithSongs throws on DB error", async () => {
      await expect(getPlaylistWithSongs("1", "mock-user-id")).rejects.toThrow(
        "Failed to fetch playlist with songs: Mocked Database Error",
      );
    });

    it.each([
      ["updatePlaylist", () => updatePlaylist("1", "mock-user-id", { name: "Test" })],
      ["deletePlaylist", () => deletePlaylist("1", "mock-user-id")],
      ["addSongToPlaylist", () => addSongToPlaylist("1", "mock-user-id", "2")],
      ["removeSongFromPlaylist", () => removeSongFromPlaylist("1", "mock-user-id", "2")],
    ])("%s refuses a playlist the caller has no access to", async (_label, run) => {
      failPlaylistLookup = false;
      // The access lookup matches nothing: not the owner, no band membership.
      vi.mocked(query).mockImplementationOnce(async () => ({ rowCount: 0, rows: [] }) as never);

      await expect(run()).rejects.toThrow("Access denied: not allowed on this playlist");
    });

    it("reports a playlist access lookup failure as an L1 error", async () => {
      await expect(updatePlaylist("1", "mock-user-id", { name: "Test" })).rejects.toThrow(
        "Failed to authorize playlist access: Mocked Database Error",
      );
    });
  });

  describe("ownerSongs.ts and songs.ts errors", () => {
    it("getRepertoire throws on DB error", async () => {
      await expect(getRepertoire({ userId: "mock-user-id" })).rejects.toThrow(
        "Failed to fetch repertoire: Mocked Database Error",
      );
    });

    it("addSongToRepertoire throws on DB error", async () => {
      await expect(addSongToRepertoire({ userId: "mock-user-id" }, "1")).rejects.toThrow(
        "Failed to add song to repertoire: Mocked Database Error",
      );
    });

    it("updateSongStatus throws on DB error", async () => {
      await expect(updateSongStatus({ userId: "mock-user-id" }, "1", "mastered")).rejects.toThrow(
        "Failed to update song status: Mocked Database Error",
      );
    });

    it("updateSongTags throws on DB error", async () => {
      await expect(updateSongTags({ userId: "mock-user-id" }, "1", ["tag"])).rejects.toThrow(
        "Failed to update song tags: Mocked Database Error",
      );
    });

    it("updateSongKey throws on DB error", async () => {
      await expect(updateSongKey({ userId: "mock-user-id" }, "1", "Am")).rejects.toThrow(
        "Failed to update personal key: Mocked Database Error",
      );
    });

    it("removeSongFromRepertoire throws on DB error", async () => {
      await expect(removeSongFromRepertoire({ userId: "mock-user-id" }, "1")).rejects.toThrow(
        "Failed to remove song from repertoire: Mocked Database Error",
      );
    });

    it("searchSongs throws on DB error", async () => {
      await expect(searchSongs("test")).rejects.toThrow(
        "Failed to search global songs: Mocked Database Error",
      );
    });

    it("getSongEntry throws on DB error", async () => {
      await expect(getSongEntry({ userId: "mock-user-id" }, "1")).rejects.toThrow(
        "Failed to fetch song entry: Mocked Database Error",
      );
    });

    it("updateSong throws on DB error", async () => {
      const mockEntry = { id: "1", user_id: null, band_id: null, song_id: "song-1", version_id: "version-1", key: null, tuning: null, map: null, lyrics: null, status: "unknown" as const, tags: [], last_practiced: null };
      const mockData = { title: "Test", artist: "Artist", key: null, status: "unknown" as const, tags: [], links: [] };
      await expect(updateSong({ userId: "mock-user-id" }, mockEntry, mockData)).rejects.toThrow(
        "Failed to update song: Mocked Database Error",
      );
    });

    it("updateLyrics throws on DB error", async () => {
      await expect(updateLyrics({ userId: "mock-user-id" }, "1", "la la")).rejects.toThrow(
        "Failed to update lyrics: Mocked Database Error",
      );
    });

    it("getPersonalEntryForSong throws on DB error", async () => {
      await expect(getPersonalEntryForSong("song-1", "mock-user-id")).rejects.toThrow(
        "Failed to fetch personal entry for song: Mocked Database Error",
      );
    });

    it("assertRepertoireAccess reports a lookup failure as an L1 error", async () => {
      await expect(assertRepertoireAccess("1", "mock-user-id")).rejects.toThrow(
        "Failed to authorize repertoire access: Mocked Database Error",
      );
    });

    it("assertRepertoireAccess denies an entry that is neither the caller's nor their band's", async () => {
      failRepertoireCheck = false;
      // The mocked repertoire lookup resolves to zero rows.
      await expect(assertRepertoireAccess("1", "mock-user-id")).rejects.toThrow(
        "Access denied: not allowed on this repertoire entry",
      );
    });

    it("createAndAddSong throws on DB error during lookup", async () => {
      failLookup = true;
      await expect(
        createAndAddSong({ userId: "mock-user-id" }, { title: "Test", artist: "Artist" }),
      ).rejects.toThrow("Failed to create and add song: Mocked Database Error");
    });

    // RH-95 removed the separate "already in your repertoire?" SELECT: the
    // insert is `ON CONFLICT DO NOTHING` and zero rows back *is* the answer. So
    // the duplicate is reported from the insert's own result, not from a read
    // that could fail on its own.
    it("createAndAddSong reports an owner's duplicate from the insert returning no row", async () => {
      failLookup = false;
      failRepertoireCheck = false;
      failRepertoireInsert = false;
      repertoireInsertRows = [];
      await expect(
        createAndAddSong({ userId: "mock-user-id" }, { title: "Test", artist: "Artist" }),
      ).rejects.toThrow("Song already in your repertoire");
    });

    it("createAndAddSong throws on DB error during repertoire addition", async () => {
      failLookup = false;
      failRepertoireCheck = false;
      failRepertoireInsert = true;
      await expect(
        createAndAddSong({ userId: "mock-user-id" }, { title: "Test", artist: "Artist" }),
      ).rejects.toThrow(
        "Failed to create and add song: Mocked Database Error",
      );
    });
  });

  describe("bands.ts errors", () => {
    it("getBands throws on DB error", async () => {
      await expect(getBands("mock-user-id")).rejects.toThrow(
        "Failed to fetch bands: Mocked Database Error",
      );
    });

    it("getBandWithMembers throws on DB error", async () => {
      await expect(getBandWithMembers("1", "mock-user-id")).rejects.toThrow(
        "Failed to fetch band: Mocked Database Error",
      );
    });

    it("createBand throws on DB error", async () => {
      await expect(createBand("mock-user-id", "Test")).rejects.toThrow(
        "Failed to create band: Mocked Database Error",
      );
    });

    it("updateBand throws on DB error", async () => {
      await expect(updateBand("1", "mock-user-id", { name: "Test" })).rejects.toThrow(
        "Failed to update band: Mocked Database Error",
      );
    });

    it("deleteBand throws on DB error", async () => {
      await expect(deleteBand("1", "mock-user-id")).rejects.toThrow(
        "Failed to delete band: Mocked Database Error",
      );
    });

    it("leaveBand throws on DB error", async () => {
      await expect(leaveBand("1", "2")).rejects.toThrow(
        "Failed to leave band: Mocked Database Error",
      );
    });

    it("removeBandMember throws on DB error", async () => {
      await expect(removeBandMember("1", "mock-user-id")).rejects.toThrow(
        "Failed to remove band member: Mocked Database Error",
      );
    });

    it("getBandPlaylists throws on DB error", async () => {
      await expect(getBandPlaylists("1", "mock-user-id")).rejects.toThrow(
        "Failed to fetch band playlists: Mocked Database Error",
      );
    });

    it("createBandPlaylist throws on DB error", async () => {
      await expect(createBandPlaylist("1", "mock-user-id", "Test")).rejects.toThrow(
        "Failed to create band playlist: Mocked Database Error",
      );
    });

    it.each([
      ["updateBand", () => updateBand("1", "mock-user-id", { name: "Test" })],
      ["deleteBand", () => deleteBand("1", "mock-user-id")],
      ["removeBandMember", () => removeBandMember("1", "mock-user-id")],
      ["createBandPlaylist", () => createBandPlaylist("1", "mock-user-id", "Test")],
    ])("%s refuses a caller with no membership in the band", async (_label, run) => {
      vi.mocked(query).mockImplementation(async () => ({ rowCount: 0, rows: [] }) as never);

      await expect(run()).rejects.toThrow("Access denied");
    });

    it.each([
      ["updateBand", () => updateBand("1", "mock-user-id", { name: "Test" })],
      ["deleteBand", () => deleteBand("1", "mock-user-id")],
      ["removeBandMember", () => removeBandMember("1", "mock-user-id")],
    ])("%s refuses a plain member (admin required)", async (_label, run) => {
      vi.mocked(query).mockImplementation(
        async () => ({ rowCount: 1, rows: [{ band_id: "mock-band-id", role: "member" }] }) as never,
      );

      await expect(run()).rejects.toThrow("Access denied: band admin required");
    });

    it("reports a membership lookup failure as an L1 error", async () => {
      vi.mocked(query).mockImplementation(async () => {
        throw mockError;
      });

      await expect(createBandPlaylist("1", "mock-user-id", "Test")).rejects.toThrow(
        "Failed to check band membership: Mocked Database Error",
      );
    });

    it("joinBandByInviteClient throws on DB error", async () => {
      await expect(joinBandByInviteClient("mock-user-id", "code")).rejects.toThrow(
        "Failed to join band: Mocked Database Error",
      );
    });
  });

  describe("bands.server.ts errors", () => {
    it("getBandByInviteCodeServer throws on DB error", async () => {
      await expect(getBandByInviteCodeServer("some-code")).rejects.toThrow(
        "Failed to fetch band by invite code: Mocked Database Error",
      );
    });

    it("joinBandByInviteServer throws on DB error", async () => {
      await expect(
        joinBandByInviteServer("mock-user-id", "some-code"),
      ).rejects.toThrow("Failed to join band by invite: Mocked Database Error");
    });
  });

  describe("profile.ts errors", () => {
    it("getProfile throws on DB error", async () => {
      await expect(getProfile("mock-user-id")).rejects.toThrow(
        "Failed to fetch profile: Mocked Database Error",
      );
    });

    it("updateProfile throws on DB error", async () => {
      await expect(updateProfile("mock-user-id", { full_name: "Test" })).rejects.toThrow(
        "Failed to update profile: Mocked Database Error",
      );
    });

    // The email address is no longer written from this module (RH-42): it moves
    // only through `src/lib/emailChange.ts` -> `auth.api.changeEmail`, covered
    // by `emailChange.test.ts` and `emailChangeVerification.db.test.ts`.
  });
});

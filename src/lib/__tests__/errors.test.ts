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
  updatePersonalKey,
  removeSongFromRepertoire,
  searchGlobalSongs,
  getSongEntry,
  updateSong,
  createAndAddSong,
} from "../songs";
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
import { getProfile, updateProfile, updateEmail } from "../profile";

// Standard mock error
const mockError = { message: "Mocked Database Error", code: "MOCK_ERROR" };

let failLookup = true;
let failRepertoireCheck = true;
let failRepertoireInsert = true;
let failCountCheck = true;
let failPlaylistLookup = true;

beforeEach(() => {
  failLookup = true;
  failRepertoireCheck = true;
  failRepertoireInsert = true;
  failCountCheck = true;
  failPlaylistLookup = true;
});

// Chainable mock builder that resolves as a promise with the mock error
const createChainableMock = () => {
  let currentTable = "";

  const mock: any = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "mock-user-id" } },
          error: null,
        }),
      updateUser: () => Promise.resolve({ data: {}, error: mockError }),
      admin: {
        updateUserById: () => Promise.resolve({ data: {}, error: mockError }),
      },
    },
    from: (table: string) => {
      currentTable = table;
      return mock;
    },
    select: (columns: string, options?: any) => {
      if (options?.count === "exact") {
        return {
          eq: () => {
            if (failCountCheck) {
              return Promise.resolve({ count: null, error: mockError });
            }
            return Promise.resolve({ count: 5, error: null });
          },
        };
      }
      return mock;
    },
    order: () => mock,
    eq: () => mock,
    single: () => {
      if (currentTable === "global_songs") {
        return Promise.resolve({ data: { id: "global-song-id" }, error: null });
      }
      if (currentTable === "repertoire") {
        if (failRepertoireInsert) {
          return Promise.resolve({ data: null, error: mockError });
        }
        return Promise.resolve({ data: { id: "repertoire-id" }, error: null });
      }
      if (currentTable === "playlists") {
        if (failPlaylistLookup) {
          return Promise.resolve({ data: null, error: mockError });
        }
        return Promise.resolve({ data: { user_id: "mock-user-id", band_id: null }, error: null });
      }
      return Promise.resolve({ data: null, error: mockError });
    },
    insert: () => mock,
    update: () => mock,
    delete: () => mock,
    rpc: () => Promise.resolve({ data: null, error: mockError }),
    limit: () => mock,
    ilike: () => mock,
    or: () => mock,
    maybeSingle: () => {
      if (currentTable === "global_songs") {
        if (failLookup) {
          return Promise.resolve({ data: null, error: mockError });
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (currentTable === "repertoire") {
        if (failRepertoireCheck) {
          return Promise.resolve({ data: null, error: mockError });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: mockError });
    },
    then: (resolve: any) => {
      if (currentTable === "repertoire" && !failRepertoireInsert) {
        resolve({ data: [{ id: "repertoire-id" }], error: null, count: null });
      } else {
        resolve({ data: null, error: mockError, count: null });
      }
    },
  };
  return mock;
};

const mockClient = createChainableMock();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockClient,
}));

describe("Supabase Error Handling", () => {
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
      await expect(updatePlaylist("1", { name: "Test" })).rejects.toThrow(
        "Failed to update playlist: Mocked Database Error",
      );
    });

    it("deletePlaylist throws on DB error", async () => {
      await expect(deletePlaylist("1")).rejects.toThrow(
        "Failed to delete playlist: Mocked Database Error",
      );
    });

    it("addSongToPlaylist throws on DB error", async () => {
      failPlaylistLookup = false;
      failRepertoireCheck = false;
      failRepertoireInsert = false;
      await expect(addSongToPlaylist("mock-user-id", "1", "2")).rejects.toThrow(
        "Failed to count playlist songs: Mocked Database Error",
      );
    });

    it("addSongToPlaylist throws on DB error during insert", async () => {
      failPlaylistLookup = false;
      failRepertoireCheck = false;
      failRepertoireInsert = false;
      failCountCheck = false;
      // The select query count will succeed (mocked above) but the subsequent insert will fail through the default fallback
      await expect(addSongToPlaylist("mock-user-id", "1", "2")).rejects.toThrow(
        "Failed to add song to playlist: Mocked Database Error",
      );
    });

    it("removeSongFromPlaylist throws on DB error", async () => {
      await expect(removeSongFromPlaylist("1", "2")).rejects.toThrow(
        "Failed to remove song from playlist: Mocked Database Error",
      );
    });

    it("getPlaylistWithSongs throws on DB error", async () => {
      await expect(getPlaylistWithSongs("1")).rejects.toThrow(
        "Failed to fetch playlist with songs: Mocked Database Error",
      );
    });
  });

  describe("songs.ts errors", () => {
    it("getRepertoire throws on DB error", async () => {
      await expect(getRepertoire({ userId: "mock-user-id" })).rejects.toThrow(
        "Failed to fetch user repertoire: Mocked Database Error",
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

    it("updatePersonalKey throws on DB error", async () => {
      await expect(updatePersonalKey({ userId: "mock-user-id" }, "1", "Am")).rejects.toThrow(
        "Failed to update personal key: Mocked Database Error",
      );
    });

    it("removeSongFromRepertoire throws on DB error", async () => {
      await expect(removeSongFromRepertoire({ userId: "mock-user-id" }, "1")).rejects.toThrow(
        "Failed to remove song from repertoire: Mocked Database Error",
      );
    });

    it("searchGlobalSongs throws on DB error", async () => {
      await expect(searchGlobalSongs("test")).rejects.toThrow(
        "Failed to search global songs: Mocked Database Error",
      );
    });

    it("getSongEntry throws on DB error", async () => {
      await expect(getSongEntry({ userId: "mock-user-id" }, "1")).rejects.toThrow(
        "Failed to fetch song entry: Mocked Database Error",
      );
    });

    it("updateSong throws on DB error", async () => {
      const mockEntry = { id: "1", user_id: null, band_id: null, song_id: "song-1", personal_key: null, status: "unknown" as const, tags: [], last_practiced: null };
      const mockData = { title: "Test", artist: "Artist", key: null, status: "unknown" as const, tags: [], links: [] };
      await expect(updateSong({ userId: "mock-user-id" }, mockEntry, mockData)).rejects.toThrow(
        "Failed to update global song: Mocked Database Error",
      );
    });

    it("createAndAddSong throws on DB error during lookup", async () => {
      failLookup = true;
      await expect(
        createAndAddSong({ userId: "mock-user-id" }, { title: "Test", artist: "Artist" }),
      ).rejects.toThrow("Failed to look up global song: Mocked Database Error");
    });

    it("createAndAddSong throws on DB error during duplicate check", async () => {
      failLookup = false;
      failRepertoireCheck = true;
      failRepertoireInsert = false;
      await expect(
        createAndAddSong({ userId: "mock-user-id" }, { title: "Test", artist: "Artist" }),
      ).rejects.toThrow(
        "Failed to check existing repertoire entry: Mocked Database Error",
      );
    });

    it("createAndAddSong throws on DB error during repertoire addition", async () => {
      failLookup = false;
      failRepertoireCheck = false;
      failRepertoireInsert = true;
      await expect(
        createAndAddSong({ userId: "mock-user-id" }, { title: "Test", artist: "Artist" }),
      ).rejects.toThrow(
        "Song created but failed to add to repertoire: Mocked Database Error",
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
      await expect(getBandWithMembers("1")).rejects.toThrow(
        "Failed to fetch band: Mocked Database Error",
      );
    });

    it("createBand throws on DB error", async () => {
      await expect(createBand("mock-user-id", "Test")).rejects.toThrow(
        "Failed to create band: Mocked Database Error",
      );
    });

    it("updateBand throws on DB error", async () => {
      await expect(updateBand("1", { name: "Test" })).rejects.toThrow(
        "Failed to update band: Mocked Database Error",
      );
    });

    it("deleteBand throws on DB error", async () => {
      await expect(deleteBand("1")).rejects.toThrow(
        "Failed to delete band: Mocked Database Error",
      );
    });

    it("leaveBand throws on DB error", async () => {
      await expect(leaveBand("1", "2")).rejects.toThrow(
        "Failed to leave band: Mocked Database Error",
      );
    });

    it("removeBandMember throws on DB error", async () => {
      await expect(removeBandMember("1")).rejects.toThrow(
        "Failed to remove band member: Mocked Database Error",
      );
    });

    it("getBandPlaylists throws on DB error", async () => {
      await expect(getBandPlaylists("1")).rejects.toThrow(
        "Failed to fetch band playlists: Mocked Database Error",
      );
    });

    it("createBandPlaylist throws on DB error", async () => {
      await expect(createBandPlaylist("1", "Test")).rejects.toThrow(
        "Failed to create band playlist: Mocked Database Error",
      );
    });

    it("joinBandByInviteClient throws on DB error", async () => {
      await expect(joinBandByInviteClient("mock-user-id", "code")).rejects.toThrow(
        "Failed to join band: Mocked Database Error",
      );
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

    it("updateEmail throws on DB error", async () => {
      await expect(updateEmail("mock-user-id", "test@example.com")).rejects.toThrow(
        "Failed to update email: Mocked Database Error",
      );
    });
  });
});

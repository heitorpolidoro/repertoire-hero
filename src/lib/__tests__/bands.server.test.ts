import { describe, it, expect, vi, beforeEach } from "vitest";
import { joinBandByInviteServer } from "../bands.server";
import { query } from "@/lib/db";

vi.mock("@/lib/db", () => {
  return {
    query: vi.fn(),
    pool: {
      query: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe("joinBandByInviteServer", () => {
  it("returns alreadyMember: false on a fresh join", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ band_id: "band-1", already_member: false }],
    } as any);
    await expect(joinBandByInviteServer("user-1", "code")).resolves.toEqual({
      bandId: "band-1",
      alreadyMember: false,
    });
  });

  it("returns alreadyMember: true when the user already belonged to the band", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ band_id: "band-1", already_member: true }],
    } as any);
    await expect(joinBandByInviteServer("user-1", "code")).resolves.toEqual({
      bandId: "band-1",
      alreadyMember: true,
    });
  });

  it("returns null when the invite code doesn't resolve to a band", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ band_id: null, already_member: null }],
    } as any);
    await expect(joinBandByInviteServer("user-1", "code")).resolves.toBeNull();
  });
});

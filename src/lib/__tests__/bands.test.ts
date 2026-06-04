import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createOriginalClient } from "@supabase/supabase-js";
import { vi } from "vitest";
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
  getBandMembers,
} from "../bands";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const skip = !SERVICE_ROLE_KEY;

const adminClient = createOriginalClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClient,
}));

describe.skipIf(skip)("bands integration tests", () => {
  const suffix = Date.now();
  const USER_A = {
    email: `test-band-a-${suffix}@example.com`,
    password: "password123",
  };
  const USER_B = {
    email: `test-band-b-${suffix}@example.com`,
    password: "password123",
  };

  let userAId: string;
  let userBId: string;
  let bandId: string;
  let inviteCode: string;
  let playlistId: string;

  beforeAll(async () => {
    // Create User A
    const {
      data: { user: userA },
      error: errA,
    } = await adminClient.auth.admin.createUser({
      email: USER_A.email,
      password: USER_A.password,
      email_confirm: true,
    });
    expect(errA).toBeNull();
    userAId = userA!.id;

    // Create User B
    const {
      data: { user: userB },
      error: errB,
    } = await adminClient.auth.admin.createUser({
      email: USER_B.email,
      password: USER_B.password,
      email_confirm: true,
    });
    expect(errB).toBeNull();
    userBId = userB!.id;
  });

  afterAll(async () => {
    if (userAId) await adminClient.auth.admin.deleteUser(userAId);
    if (userBId) await adminClient.auth.admin.deleteUser(userBId);
  });

  it("should allow User A to create a band", async () => {
    bandId = await createBand(
      userAId,
      `Test Band ${suffix}`,
      "A cool test band",
      "https://example.com/cover.jpg",
    );
    expect(bandId).toBeDefined();
    expect(typeof bandId).toBe("string");
  });

  it("should allow User A to get their bands", async () => {
    const bands = await getBands(userAId);
    expect(bands).toBeDefined();
    expect(Array.isArray(bands)).toBe(true);
    expect(bands.some((b) => b.id === bandId)).toBe(true);
  });

  it("should allow User A to get band with members", async () => {
    const band = await getBandWithMembers(bandId);
    expect(band).not.toBeNull();
    expect(band!.name).toBe(`Test Band ${suffix}`);
    expect(band!.invite_code).toBeDefined();
    inviteCode = band!.invite_code;

    const members = (band as any).members;
    expect(members).toBeDefined();
    expect(members.length).toBe(1);
    expect(members[0].user_id).toBe(userAId);
    expect(members[0].role).toBe("admin");
  });

  it("should allow User B to join the band by invite code", async () => {
    const joinedBandId = await joinBandByInviteClient(userBId, inviteCode);
    expect(joinedBandId).toBe(bandId);
  });

  it("should show User B as a member when fetching the band", async () => {
    const band = await getBandWithMembers(bandId);
    expect(band).not.toBeNull();

    const members = (band as any).members;
    expect(members.length).toBe(2);

    const memberB = members.find((m: any) => m.user_id === userBId);
    expect(memberB).toBeDefined();
    expect(memberB.role).toBe("member");
  });

  it("should allow creating and fetching band playlists", async () => {
    playlistId = await createBandPlaylist(bandId, "Rock Anthems");
    expect(playlistId).toBeDefined();

    const playlists = await getBandPlaylists(bandId);
    expect(playlists).toBeDefined();
    expect(playlists.some((p) => p.id === playlistId)).toBe(true);
  });

  it("should allow updating the band", async () => {
    await updateBand(bandId, { name: `Updated Name ${suffix}` });

    const band = await getBandWithMembers(bandId);
    expect(band!.name).toBe(`Updated Name ${suffix}`);
  });

  it("should allow removing a band member", async () => {
    const bandBefore = await getBandWithMembers(bandId);
    const membersBefore = (bandBefore as any).members;
    const memberB = membersBefore.find((m: any) => m.user_id === userBId);
    expect(memberB).toBeDefined();

    await removeBandMember(memberB.id);

    const bandAfter = await getBandWithMembers(bandId);
    const membersAfter = (bandAfter as any).members;
    expect(membersAfter.length).toBe(1);
    expect(membersAfter.some((m: any) => m.user_id === userBId)).toBe(false);
  });

  it("should allow a member to leave the band", async () => {
    // Re-join as User B
    const joinedBandId = await joinBandByInviteClient(userBId, inviteCode);
    expect(joinedBandId).toBe(bandId);

    const bandBefore = await getBandWithMembers(bandId);
    expect((bandBefore as any).members.length).toBe(2);

    // Leave the band
    await leaveBand(bandId, userBId);

    const bandAfter = await getBandWithMembers(bandId);
    const membersAfter = (bandAfter as any).members;
    expect(membersAfter.length).toBe(1);
    expect(membersAfter.some((m: any) => m.user_id === userBId)).toBe(false);
  });

  it("should allow deleting the band", async () => {
    await deleteBand(bandId);

    const band = await getBandWithMembers(bandId);
    expect(band).toBeNull();
  });

  it("getBandMembers returns members when defined and empty array when undefined", () => {
    const bandWithMembers = {
      id: "1",
      name: "Band",
      members: [{ id: "m1" }],
    } as any;
    const bandWithoutMembers = { id: "2", name: "Band" } as any;
    expect(getBandMembers(bandWithMembers)).toEqual([{ id: "m1" }]);
    expect(getBandMembers(bandWithoutMembers)).toEqual([]);
  });
});

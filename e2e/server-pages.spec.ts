/**
 * RH-62 — `/bands` and `/admin/moderation` are Server Components.
 *
 * These assert on the raw HTTP document with no JavaScript executed, in the
 * style of `ssr-smoke.spec.ts`. Before the conversion both routes were
 * prerendered static shells whose documents carried a client-side loading
 * placeholder ("Loading bands..." / "Loading moderation queue...") and no data;
 * after it the server reads through `@/lib` and ships the finished markup, so
 * the placeholders can no longer appear in the response body.
 *
 * The e2e user is a non-admin (`profiles.is_system_admin` defaults to false),
 * which is exactly the fixture the Access Denied branch needs.
 *
 * RH-63 adds `/playlists`. That route had no loading placeholder to look for —
 * its prerendered shell simply carried no playlist at all — so the assertion is
 * the stronger one: a playlist created through the UI has to be *in* the raw
 * document of the very next request, which can only happen if the server read
 * it. The second test pins the delete path, its `router.refresh()` and the
 * absence of a browser dialog behind the `Sure? / Yes / No` affordance.
 *
 * RH-71 adds `/playlists/[id]`, the last route of the conversion. It had a real
 * loading placeholder — a `Spinner` and the word `Loading...` — which the
 * conversion deletes, so the assertion is again the stronger one: the playlist
 * name has to be in the raw document of a request that runs no JavaScript. The
 * signed-out test pins the other half, that the proxy still answers an
 * anonymous request to the route with a 307 to `/login`.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { AUTH_STATE_PATH } from "./global-setup";
import { deletePlaylistFromDetail, openPlaylist } from "./helpers";

const ERROR_DOCUMENT_MARKER = 'id="__next_error__"';

test.use({ storageState: AUTH_STATE_PATH });

test("GET /bands signed in is server-rendered with no loading placeholder", async ({
  request,
}) => {
  const res = await request.get("/bands");

  expect(res.status()).toBe(200);

  const body = await res.text();
  expect(body).not.toContain("Loading bands...");
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER);
});

test("GET /admin/moderation signed in as a non-admin renders Access Denied", async ({
  request,
}) => {
  const res = await request.get("/admin/moderation");

  expect(res.status()).toBe(200);

  const body = await res.text();
  expect(body).toContain("Access Denied");
  expect(body).not.toContain("Loading moderation queue...");
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER);
});

/** Creates a uniquely named playlist through the modal and returns its name. */
async function createPlaylist(page: Page): Promise<string> {
  const name = `E2E Server Playlist ${Date.now()}`;

  await page.goto("/playlists");

  const newPlaylistButton = page.getByRole("button", {
    name: "+ New Playlist",
  });
  const nameInput = page.getByLabel("Playlist name");

  // The header paints before React hydrates, so a click can be swallowed on a
  // cold route. Retry opening the modal until the name field actually appears.
  await expect(newPlaylistButton).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await newPlaylistButton.click();
    await expect(nameInput).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  await nameInput.fill(name);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("button", { name: `Open ${name}` })).toBeVisible({
    timeout: 15_000,
  });
  return name;
}

/**
 * Deletes a playlist through the inline `Sure? / Yes` affordance, and returns
 * only once the **server** no longer carries it.
 *
 * `PlaylistsView` hides the row optimistically (it records the removed id
 * before awaiting the Server Action), so the row disappearing proves nothing
 * about the write having committed: a `request.get('/playlists')` issued right
 * after it can still be served the deleted playlist. The wait is therefore on
 * server truth, twice over — the delete Server Action's own POST response
 * (registered *before* the confirming click, so it cannot be missed, the same
 * shape `serverActionResponse` uses in `playlist-detail.spec.ts`), then a
 * bounded re-read of the server-rendered document.
 */
async function deletePlaylist(
  page: Page,
  request: APIRequestContext,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: `Delete ${name}` }).click();

  const deleteWrite = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/playlists",
  );
  await page.getByRole("button", { name: "Yes" }).click();

  await expect(page.getByRole("button", { name: `Open ${name}` })).toHaveCount(
    0,
  );
  await deleteWrite;

  await expect
    .poll(async () => (await request.get("/playlists")).text(), {
      timeout: 15_000,
    })
    .not.toContain(name);
}

test("GET /playlists signed in is server-rendered with the playlist rows in the document", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const name = await createPlaylist(page);

  const res = await request.get("/playlists");

  expect(res.status()).toBe(200);

  const body = await res.text();
  expect(body).toContain(name);
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER);

  // Leave no stray playlist behind for the next run.
  await deletePlaylist(page, request, name);
});

test("deleting a playlist through the inline confirmation removes it from the server-rendered document", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  // Playwright auto-dismisses native dialogs, so a `confirm()` would silently
  // resolve to false. Recording them proves the affordance is in-page.
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss().catch(() => undefined);
  });

  const name = await createPlaylist(page);
  await deletePlaylist(page, request, name);

  const res = await request.get("/playlists");

  expect(res.status()).toBe(200);

  const body = await res.text();
  expect(body).not.toContain(name);
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER);
  expect(dialogs).toEqual([]);
});

test("GET a playlist detail route signed in is server-rendered with the playlist name in the document", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const name = await createPlaylist(page);

  // Through the same helpers the characterization net uses, so the hydration
  // wait `openPlaylist` now carries applies here too.
  const detailUrl = await openPlaylist(page, name);
  const path = new URL(detailUrl).pathname;

  const res = await request.get(path);

  expect(res.status()).toBe(200);

  const body = await res.text();
  expect(body).toContain(name);
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER);

  // Leave no stray playlist behind for the next run.
  await deletePlaylistFromDetail(page);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("GET a playlist detail route signed out is redirected to /login", async ({
    request,
  }) => {
    const res = await request.get(
      "/playlists/00000000-0000-0000-0000-000000000000",
      {
        maxRedirects: 0,
      },
    );

    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain(
      "/login?redirect=%2Fplaylists%2F",
    );
  });
});

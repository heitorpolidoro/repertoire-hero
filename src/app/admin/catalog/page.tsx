import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { checkSystemAdmin } from "@/lib/moderation";
import { searchSongs } from "@/lib/songs";
import { CATALOG_ADMIN_ACTIONS } from "@/app/catalogAdminActions";
import { AccessDeniedPanel } from "@/components/admin/AccessDeniedPanel";
import { CatalogAdmin } from "@/components/admin/CatalogAdmin";

/**
 * Server Component (RH-156): the system admin's catalog screen. It gates itself
 * - the proxy is only a redirect convenience - and reads nothing from the
 * catalog until `checkSystemAdmin` has passed. The search term lives in `?q=`,
 * so results are server-rendered and a mutation is followed by `router.refresh()`.
 */
export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  try {
    await checkSystemAdmin(userId);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message.startsWith("Access denied")) return <AccessDeniedPanel />;
    throw err;
  }

  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const songs = query ? await searchSongs(query) : [];

  return <CatalogAdmin query={query} songs={songs} actions={CATALOG_ADMIN_ACTIONS} />;
}

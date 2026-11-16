import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { parseMockSessionId } from "@/lib/billing/mockAdapter";
import { PRO_PRICES } from "@/lib/billing/prices";
import { MockCheckoutPanel } from "@/components/settings/MockCheckoutPanel";
import { MOCK_CHECKOUT_ACTIONS } from "@/app/billingActions";

/**
 * RH-202: the mock provider's hosted checkout (`?session_id=`) and customer
 * portal (`?portal=1`). Server Component: it resolves its own session rather
 * than trusting the proxy, and `completeMockCheckoutAction` re-checks that the
 * session belongs to the signed-in user before activating anything.
 */
export default async function MockCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; portal?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const { session_id: sessionId, portal } = await searchParams;
  const mode = portal ? "portal" : "checkout";
  const interval = (sessionId && parseMockSessionId(sessionId)?.interval) || "monthly";

  return (
    <div className="px-4 py-6">
      <MockCheckoutPanel
        actions={MOCK_CHECKOUT_ACTIONS}
        mode={mode}
        sessionId={sessionId ?? null}
        priceLabel={PRO_PRICES[interval].label}
      />
    </div>
  );
}

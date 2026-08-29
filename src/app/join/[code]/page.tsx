import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getSession } from "@/lib/auth-session";
import {
  getBandByInviteCodeServer,
  joinBandByInviteServer,
} from "@/lib/bands.server";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; joined?: string }>;
}

export default async function JoinBandPage({ params, searchParams }: Props) {
  const { code } = await params;
  const { error: joinError, joined } = await searchParams;
  const alreadyMember = joined === "already";

  // Look up band info — works for anonymous users (SECURITY DEFINER RPC)
  let bandInfo: Awaited<ReturnType<typeof getBandByInviteCodeServer>> = null;
  let lookupFailed = false;
  try {
    bandInfo = await getBandByInviteCodeServer(code);
  } catch {
    lookupFailed = true;
  }

  if (lookupFailed) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-xl font-bold text-gray-900">
            Something went wrong
          </h1>
          <p className="text-sm text-gray-500">
            We couldn&apos;t check this invite link right now. This
            doesn&apos;t necessarily mean the link is bad — please try again
            in a moment.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href={`/join/${code}`}
              className="text-sm font-medium text-emerald-600 hover:text-emerald-500"
            >
              Try again
            </Link>
            <Link
              href="/"
              className="text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Go home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!bandInfo) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-5xl">🔗</div>
          <h1 className="text-xl font-bold text-gray-900">
            Invalid invite link
          </h1>
          <p className="text-sm text-gray-500">
            This invite link is no longer valid. It may be incorrect, or the
            band admin may have generated a new one.
          </p>
          <Link
            href="/"
            className="inline-block text-sm font-medium text-emerald-600 hover:text-emerald-500"
          >
            Go home
          </Link>
        </div>
      </main>
    );
  }

  // Check if the user is authenticated
  const session = await getSession();
  const user = session?.user ?? null;

  async function handleAccept() {
    "use server";
    const currentSession = await getSession();
    if (!currentSession?.user?.id) {
      redirect("/bands");
    }

    let joinResult: Awaited<ReturnType<typeof joinBandByInviteServer>> = null;
    let joinFailed = false;
    try {
      joinResult = await joinBandByInviteServer(
        currentSession.user.id,
        code
      );
    } catch {
      joinFailed = true;
    }

    if (joinFailed) {
      redirect(`/join/${code}?error=technical`);
    }
    if (joinResult) {
      if (joinResult.alreadyMember) {
        redirect(`/join/${code}?joined=already`);
      }
      redirect(`/bands/${joinResult.bandId}`);
    }
    redirect(`/join/${code}?error=invalid`);
  }

  const joinPath = `/join/${code}`;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-2xl">🎸</span>
            <span className="text-2xl font-bold text-gray-900">
              Repertoire Hero
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 md:p-8 space-y-6">
          <div className="flex items-center gap-4">
            {bandInfo.cover_url ? (
              <Image
                src={bandInfo.cover_url}
                alt={bandInfo.name}
                width={64}
                height={64}
                className="w-16 h-16 rounded-2xl object-cover shrink-0 border border-gray-100 shadow-sm"
                unoptimized
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-3xl shrink-0 font-bold">
                🎸
              </div>
            )}
            <div className="min-w-0">
              <span className="inline-block text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md uppercase tracking-wider mb-1">
                Band Invitation
              </span>
              <h2 className="text-xl font-bold text-gray-900 truncate">
                {bandInfo.name}
              </h2>
              {bandInfo.description && (
                <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                  {bandInfo.description}
                </p>
              )}
              <p className="text-xs text-gray-400 font-medium mt-1">
                👥 {bandInfo.member_count} member
                {bandInfo.member_count !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          {user ? (
            alreadyMember ? (
              /* Authenticated + already a member: non-error interstitial */
              <div className="space-y-4 text-center">
                <div className="text-3xl">🎸</div>
                <h3 className="text-base font-bold text-gray-900">
                  You&apos;re already a member!
                </h3>
                <p className="text-xs text-gray-500">
                  You&apos;re already part of {bandInfo.name} — no need to
                  accept again.
                </p>
                <Link
                  href={`/bands/${bandInfo.id}`}
                  className="block w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-emerald-700 shadow-md shadow-emerald-950/20 transition-all"
                >
                  Go to {bandInfo.name}
                </Link>
              </div>
            ) : (
              /* Authenticated: Show Accept / Decline Modal Card */
              <div className="space-y-4">
                {joinError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    {joinError === "technical"
                      ? "Something went wrong while joining. Please try again."
                      : "This invite is no longer valid — it may have just been revoked by the band admin."}
                  </p>
                )}
                <div className="text-center space-y-1">
                  <h3 className="text-base font-bold text-gray-900">
                    Accept invitation?
                  </h3>
                  <p className="text-xs text-gray-500">
                    You are signed in as{" "}
                    <span className="font-semibold text-gray-700">
                      {user.email}
                    </span>
                    . Joining will give you access to {bandInfo.name}&apos;s
                    shared repertoire and playlists.
                  </p>
                </div>

                <div className="flex flex-col gap-2.5 pt-2">
                  <form action={handleAccept}>
                    <button
                      type="submit"
                      className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 shadow-md shadow-emerald-950/20 transition-all transform active:scale-95"
                    >
                      Accept Invitation & Join
                    </button>
                  </form>
                  <Link
                    href="/"
                    className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-center text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                  >
                    Decline / Cancel
                  </Link>
                </div>
              </div>
            )
          ) : (
            /* Unauthenticated: Show Sign In / Sign Up Call to Actions */
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-gray-900">
                  Sign in to accept
                </h3>
                <p className="text-xs text-gray-500">
                  Sign in or create a free account to join {bandInfo.name} and
                  sync your repertoire.
                </p>
              </div>

              <div className="space-y-2.5 pt-1">
                <Link
                  href={`/login?redirect=${encodeURIComponent(joinPath)}`}
                  className="block w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-emerald-700 shadow-md shadow-emerald-950/20 transition-all"
                >
                  Sign in to accept
                </Link>
                <Link
                  href={`/signup?redirect=${encodeURIComponent(joinPath)}`}
                  className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-center text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Create free account
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import {
  getBandByInviteCodeServer,
  joinBandByInviteServer,
} from "@/lib/bands.server";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function JoinBandPage({ params }: Props) {
  const { code } = await params;

  // Look up band info — works for anonymous users (SECURITY DEFINER RPC)
  const bandInfo = await getBandByInviteCodeServer(code);

  if (!bandInfo) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-5xl">🔗</div>
          <h1 className="text-xl font-bold text-gray-900">
            Invalid invite link
          </h1>
          <p className="text-sm text-gray-500">
            This invite link is invalid or has expired.
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If authenticated, join automatically and redirect to the band page
  if (user) {
    const bandId = await joinBandByInviteServer(code);
    if (bandId) {
      redirect(`/bands/${bandId}`);
    }
    // Already a member or error — redirect to bands list
    redirect("/bands");
  }

  // Not authenticated — show band info and sign in / sign up options
  const joinPath = `/join/${code}`;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Repertoire Hero</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-md px-6 py-6 space-y-5">
          <div className="flex items-center gap-4">
            {bandInfo.cover_url ? (
              <Image
                src={bandInfo.cover_url}
                alt={bandInfo.name}
                width={56}
                height={56}
                className="w-14 h-14 rounded-xl object-cover shrink-0"
                unoptimized
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-emerald-100 flex items-center justify-center text-3xl shrink-0">
                🎸
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-0.5">
                You&apos;re invited to join
              </p>
              <h2 className="text-lg font-bold text-gray-900">
                {bandInfo.name}
              </h2>
              {bandInfo.description && (
                <p className="text-sm text-gray-500">{bandInfo.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">
                {bandInfo.member_count} member
                {bandInfo.member_count !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <hr className="border-gray-100" />

          <div className="space-y-3">
            <Link
              href={`/login?redirect=${encodeURIComponent(joinPath)}`}
              className="block w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              Sign in to join
            </Link>
            <Link
              href={`/signup?redirect=${encodeURIComponent(joinPath)}`}
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

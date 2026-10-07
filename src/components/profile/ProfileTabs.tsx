"use client";

import { useState, type ReactNode } from "react";
import { getBandThemeStyles } from "@/lib/bandColors";
import type { BandContext } from "@/store/bandContextStore";

type ProfileTab = "band" | "personal";

interface ProfileTabsProps {
  context: BandContext;
  /** `null` outside band mode — `BandContext` only carries an `id` on its `band` arm. */
  bandPanel: ReactNode;
  personalPanel: ReactNode;
}

/**
 * The stateful half. Mounted under a key by `ProfileTabs` below, so a context
 * change resets `activeTab` by remount rather than by a state write from an
 * effect (`react-hooks/set-state-in-effect`, RH-129 §A1).
 */
function ProfileTabsView({ context, bandPanel, personalPanel }: ProfileTabsProps) {
  const isBandMode = context.type === "band";
  const [activeTab, setActiveTab] = useState<ProfileTab>(isBandMode ? "band" : "personal");

  const bandTheme = getBandThemeStyles(context.type === "band" ? context.color : null);
  const showBandPanel = activeTab === "band" && isBandMode;

  return (
    <>
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 md:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {context.type === "band" && activeTab === "band"
              ? `Band Profile · ${context.name}`
              : "Personal Profile"}
          </h1>
        </div>

        {/* Tab switcher when in Band Mode */}
        {context.type === "band" && (
          <div className="flex bg-gray-100 p-1 rounded-xl self-start sm:self-auto">
            <button
              onClick={() => setActiveTab("band")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === "band"
                  ? "shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              style={activeTab === "band" ? bandTheme.style : undefined}
            >
              🎸 {context.name}
            </button>
            <button
              onClick={() => setActiveTab("personal")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === "personal"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              👤 Personal
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 max-w-3xl">
        {showBandPanel ? bandPanel : personalPanel}
      </div>
    </>
  );
}

/**
 * The profile page's tabbed subtree: the header, the band/personal switcher and
 * the content slot.
 *
 * The key lives here rather than at the call site so the reset mechanism is
 * reachable from a unit test, and it is **`context.type`** — nothing else. The
 * effect this replaced depended on `[context.type]`, so a band→band switch kept
 * whichever tab the user had selected; `key={context.id}` would instead remount
 * the band panel on every band→band switch, throwing away its loaded state.
 */
export function ProfileTabs(props: ProfileTabsProps) {
  return <ProfileTabsView key={props.context.type} {...props} />;
}

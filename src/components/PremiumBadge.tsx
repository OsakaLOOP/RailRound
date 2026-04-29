import React from "react";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { Crown, Sparkles } from "lucide-react";

export const PremiumBadge: React.FC = () => {
  const { tier, isLoggedIn } = useStore(
    useShallow((state) => ({
      tier: state.userProfile?.tier,
      isLoggedIn: state.isLoggedIn,
    }))
  );

  if (!isLoggedIn || !tier || tier === "free") return null;

  if (tier === "permanent") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full
                   bg-gradient-to-r from-amber-400 via-yellow-500 to-orange-500 text-white shadow-sm"
        title="Permanent Member"
      >
        <Crown size={12} />
        PERMANENT
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full
                 bg-yellow-400 text-yellow-900 shadow-sm"
      title="Premium Member"
    >
      <Sparkles size={12} />
      PREMIUM
    </span>
  );
};

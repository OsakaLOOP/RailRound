import React from "react";
import { Crown, Sparkles, Clock, CheckCircle2 } from "lucide-react";
import type { TierLevel } from "../store";

interface SubscriptionStatusProps {
  tier: TierLevel;
  subscriptionMonths: number;
  tierExpiresAt?: string | null;
  permanentUpgradedAt?: string | null;
}

export const SubscriptionStatus: React.FC<SubscriptionStatusProps> = ({
  tier,
  subscriptionMonths,
  tierExpiresAt,
  permanentUpgradedAt,
}) => {
  const progressPercent = Math.min(100, Math.round((subscriptionMonths / 12) * 100));

  if (tier === "permanent") {
    return (
      <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Crown size={18} className="text-amber-500" />
          <span className="font-bold text-amber-800">Permanent Member</span>
        </div>
        <p className="text-sm text-amber-700">
          Thank you for {subscriptionMonths}+ months of continuous support.
        </p>
        {permanentUpgradedAt && (
          <p className="text-xs text-amber-500 mt-1">
            Upgraded on{" "}
            {new Date(permanentUpgradedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1 text-xs text-amber-600">
          <CheckCircle2 size={12} />
          All premium features unlocked forever
        </div>
      </div>
    );
  }

  if (tier === "premium") {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={18} className="text-yellow-600" />
          <span className="font-bold text-yellow-800">Premium Member</span>
        </div>
        <div className="mb-2">
          <div className="flex justify-between text-xs text-yellow-700 mb-1">
            <span>Progress to Permanent</span>
            <span>
              {subscriptionMonths}/12 months
            </span>
          </div>
          <div className="w-full bg-yellow-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-yellow-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        {tierExpiresAt && (
          <p className="text-xs text-yellow-600 flex items-center gap-1">
            <Clock size={12} />
            Current period expires{" "}
            {new Date(tierExpiresAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={18} className="text-gray-400" />
        <span className="font-bold text-gray-600">Free Tier</span>
      </div>
      <p className="text-sm text-gray-500 mb-2">
        Support the project to unlock Premium features.
      </p>
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className="bg-gray-400 h-2 rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
};

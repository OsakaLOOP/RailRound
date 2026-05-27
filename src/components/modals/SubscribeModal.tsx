import React, { useState, useEffect, useCallback } from "react";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { X, ExternalLink, Link, Loader2 } from "lucide-react";
import { api } from "../../services/api";
import { SubscriptionStatus } from "../SubscriptionStatus";

export const SubscribeModal: React.FC = () => {
  const { t } = useTranslation();

  const {
    isOpen,
    user,
    userProfile,
    setModalState,
  } = useStore(
    useShallow((state) => ({
      isOpen: state.modals.isSubscribeOpen,
      user: state.user,
      userProfile: state.userProfile,
      setModalState: state.setModalState,
    }))
  );

  const [afdianUserId, setAfdianUserId] = useState("");
  const [binding, setBinding] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const tier = userProfile?.tier || "free";
  const subscriptionMonths = userProfile?.subscriptionMonths || 0;
  const tierExpiresAt = userProfile?.tierExpiresAt;
  const permanentUpgradedAt = userProfile?.permanentUpgradedAt;

  const onClose = useCallback(() => {
    setModalState({ isSubscribeOpen: false });
    setAfdianUserId("");
    setBindError(null);
  }, [setModalState]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Refresh tier status on open
  useEffect(() => {
    if (!isOpen || !user?.token) return;
    setLoadingStatus(true);
    api
      .getTierStatus(user.token)
      .then((data: any) => {
        useStore.getState().setUserProfile({
          ...useStore.getState().userProfile,
          tier: data.tier,
          tierToken: data.tierToken,
          tierExpiresAt: data.tierExpiresAt,
          permanentUpgradedAt: data.permanentUpgradedAt,
          subscriptionMonths: data.subscriptionMonths,
        } as any);
      })
      .catch(() => {
        // best-effort
      })
      .finally(() => setLoadingStatus(false));
  }, [isOpen, user?.token]);

  const handleBind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.token || !afdianUserId.trim()) return;
    setBinding(true);
    setBindError(null);

    try {
      const data = await api.bindAfdian(user.token, afdianUserId.trim());
      useStore.getState().setUserProfile({
        ...useStore.getState().userProfile,
        tier: data.tier,
        tierToken: data.tierToken,
        tierExpiresAt: data.tierExpiresAt,
        permanentUpgradedAt: data.permanentUpgradedAt,
        subscriptionMonths: data.subscriptionMonths,
      } as any);
      toast.success(
        data.tier === "premium"
          ? t("premium.bindSuccess", "Afdian account bound! Welcome to Premium.")
          : t("premium.bindSuccessPermanent", "Afdian account bound! You are now a Permanent member.")
      );
      setAfdianUserId("");
    } catch (err: any) {
      setBindError(err.message || "Binding failed");
    } finally {
      setBinding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">
            {t("premium.title", "RailLOOP Premium")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Status */}
        {loadingStatus ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <SubscriptionStatus
            tier={tier}
            subscriptionMonths={subscriptionMonths}
            tierExpiresAt={tierExpiresAt}
            permanentUpgradedAt={permanentUpgradedAt}
          />
        )}

        {/* Benefits */}
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-bold text-gray-700">
            {t("premium.benefits", "Premium Benefits")}
          </h3>
          <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
            <li>{t("premium.benefitOcr", "50 OCR ticket scans per month")}</li>
            <li>{t("premium.benefitLlm", "100 AI assistant queries per month")}</li>
            <li>{t("premium.benefitDiary", "AI trip diary generation")}</li>
            <li>{t("premium.benefitReport", "Annual travel report")}</li>
            <li>{t("premium.benefitPhotos", "500 trip photos (up to 10MB each)")}</li>
            <li>{t("premium.benefitStats", "Background statistics calculation")}</li>
            <li>{t("premium.benefitShare", "Trip card sharing")}</li>
            <li>{t("premium.benefitPermanent", "12 months → Permanent status (no expiry)")}</li>
          </ul>
        </div>

        {/* Pricing */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="border border-gray-200 rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-gray-800">¥8</div>
            <div className="text-xs text-gray-500">
              {t("premium.priceMonthly", "/ month")}
            </div>
          </div>
          <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-yellow-800">¥60</div>
            <div className="text-xs text-yellow-600">
              {t("premium.priceYearly", "/ year (save ¥36)")}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-400 text-center">
          {t("premium.anyAmount", "Or any amount — every bit helps keep the project alive.")}
        </p>

        {/* Afdian link */}
        <a
          href="https://afdian.com/a/OsakaLOOP"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-xl
                     bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold
                     hover:from-pink-600 hover:to-rose-600 transition-all shadow-md"
        >
          <ExternalLink size={16} />
          {t("premium.goAfdian", "Subscribe on Afdian")}
        </a>

        {/* Binding section */}
        {user && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1">
              <Link size={14} />
              {t("premium.bindTitle", "Already subscribed? Bind your account")}
            </h3>
            <form onSubmit={handleBind} className="flex gap-2">
              <input
                type="text"
                value={afdianUserId}
                onChange={(e) => setAfdianUserId(e.target.value)}
                placeholder={t("premium.afdianIdPlaceholder", "Your Afdian user ID")}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={binding}
              />
              <button
                type="submit"
                disabled={binding || !afdianUserId.trim()}
                className="px-4 py-2 text-sm font-bold text-white bg-blue-500 rounded-lg
                           hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
              >
                {binding ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  t("premium.bind", "Bind")
                )}
              </button>
            </form>
            {bindError && (
              <p className="mt-2 text-xs text-red-500">{bindError}</p>
            )}
            <p className="mt-2 text-xs text-gray-400">
              {t(
                "premium.bindHint",
                'Your Afdian user ID can be found in your Afdian profile page URL: afdian.com/u/YOUR_ID'
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

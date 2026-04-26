import React, { useMemo } from "react";
import { useT, promoRandom, type Locale } from "./i18n";

interface PromoBannerProps {
  locale?: Locale;
  color?: string | null;
  labels?: Record<string, string>;
  dark?: boolean;
}

export const PromoBanner: React.FC<PromoBannerProps> = ({
  locale = "en" as Locale,
  color,
  labels,
  dark,
}) => {
  const t = useT(locale, labels);
  const tagline = useMemo(() => promoRandom(locale ?? "en"), [locale]);
  const dotColor = color || "#39C5BB";

  return (
    <a
      href="https://rail.s3xyseia.xyz/?utm_source=route-preview&utm_medium=embed"
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-center gap-2 px-4 py-2.5 text-xs transition-colors no-underline ${
        dark
          ? "text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-700 border-t border-slate-700"
          : "text-slate-500 hover:text-slate-700 bg-slate-50/80 hover:bg-slate-100 border-t border-slate-200/60"
      }`}
    >
      <span
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <span className="text-[11px] leading-tight">{tagline}</span>
      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold text-white bg-green-500 hover:bg-green-600 transition-colors shrink-0 shadow-sm">
        {t("promoCTA")}
      </span>
    </a>
  );
};

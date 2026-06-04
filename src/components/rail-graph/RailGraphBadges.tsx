import React from "react";

export type RailGraphBadgeIcon =
  | "snapshot"
  | "pattern"
  | "service"
  | "direction"
  | "distance"
  | "duration"
  | "userEvent"
  | "stops"
  | "via"
  | "departure"
  | "arrival"
  | "transfer"
  | "reverse"
  | "formation"
  | "serviceSwitch"
  | "scenic"
  | "warning"
  | "operation"
  | "custom"
  | "stop"
  | "pass"
  | "note"
  | "legacy";

export type RailGraphBadgeTone =
  | "emerald"
  | "indigo"
  | "sky"
  | "amber"
  | "violet"
  | "rose"
  | "slate";

const toneClasses: Record<RailGraphBadgeTone, string> = {
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
  sky: "border-sky-100 bg-sky-50 text-sky-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  violet: "border-violet-100 bg-violet-50 text-violet-700",
  rose: "border-rose-100 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
};

export const railGraphEventTone = (type: string): RailGraphBadgeTone => {
  if (type === "departure" || type === "arrival") return "emerald";
  if (type === "transfer") return "amber";
  if (type === "reverse_operation") return "sky";
  if (type === "formation_operation") return "violet";
  if (type === "service_class_switch") return "sky";
  if (type === "scenic") return "sky";
  if (type === "warning") return "amber";
  if (type === "operation_hint") return "violet";
  if (type === "custom") return "slate";
  if (type === "user_note") return "emerald";
  if (type === "user_event" || type === "note") return "violet";
  if (type === "pass") return "slate";
  return "indigo";
};

export const railGraphEventIcon = (type: string): RailGraphBadgeIcon => {
  if (type === "departure") return "departure";
  if (type === "arrival") return "arrival";
  if (type === "transfer") return "transfer";
  if (type === "reverse_operation") return "reverse";
  if (type === "formation_operation") return "formation";
  if (type === "service_class_switch") return "serviceSwitch";
  if (type === "scenic") return "scenic";
  if (type === "warning") return "warning";
  if (type === "operation_hint") return "operation";
  if (type === "custom") return "custom";
  if (type === "user_note") return "note";
  if (type === "stop") return "stop";
  if (type === "pass") return "pass";
  if (type === "user_event") return "userEvent";
  if (type === "note") return "note";
  return "snapshot";
};

export const RailGraphSymbol: React.FC<{
  name: RailGraphBadgeIcon;
  className?: string;
}> = ({ name, className = "h-3 w-3" }) => {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      {name === "snapshot" && (
        <>
          <path {...common} d="M3 4.5 8 2l5 2.5v7L8 14l-5-2.5z" />
          <path {...common} d="M8 2v12M3 4.5l5 2.5 5-2.5" />
        </>
      )}
      {name === "pattern" && (
        <>
          <path {...common} d="M2.5 11.5c2-5 5-7 11-7" />
          <path {...common} d="M2.5 6.5c3 0 4 3 6 3s2.8-2 5-2" />
          <circle cx="4" cy="11" r="1" fill="currentColor" />
          <circle cx="12" cy="4.8" r="1" fill="currentColor" />
        </>
      )}
      {name === "service" && (
        <>
          <rect {...common} x="3" y="3.5" width="10" height="8" rx="2" />
          <path {...common} d="M5 6h6M5.5 12.5l-1 1M11.5 12.5l1 1" />
          <circle cx="5.6" cy="9.5" r="0.8" fill="currentColor" />
          <circle cx="10.4" cy="9.5" r="0.8" fill="currentColor" />
        </>
      )}
      {name === "direction" && (
        <>
          <path {...common} d="M3 8h9" />
          <path {...common} d="m9 4 4 4-4 4" />
          <path {...common} d="M4.5 4.5a5 5 0 0 1 7 0" />
        </>
      )}
      {name === "distance" && (
        <>
          <path {...common} d="M3 12c1.5-5.5 8-3 10-8" />
          <circle cx="3" cy="12" r="1.2" fill="currentColor" />
          <circle cx="13" cy="4" r="1.2" fill="currentColor" />
        </>
      )}
      {name === "duration" && (
        <>
          <circle {...common} cx="8" cy="8.5" r="5" />
          <path {...common} d="M8 5.5v3l2 1.2" />
          <path {...common} d="M6.5 2h3" />
        </>
      )}
      {name === "userEvent" && (
        <>
          <path {...common} d="M4 4.5h8v7H7l-3 2v-2z" />
          <path {...common} d="M6 7h4M6 9h2.5" />
        </>
      )}
      {name === "stops" && (
        <>
          <path {...common} d="M3 8h10" />
          <circle cx="4" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="12" cy="8" r="1.4" fill="currentColor" />
        </>
      )}
      {name === "via" && (
        <>
          <path {...common} d="M3 12V6a2 2 0 0 1 2-2h3" />
          <path {...common} d="M8 4h3a2 2 0 0 1 2 2v6" />
          <path {...common} d="m10.5 9.5 2.5 2.5 2.5-2.5" />
        </>
      )}
      {name === "departure" && (
        <>
          <path {...common} d="M3 11h10" />
          <path {...common} d="M5 11 9.5 4 12 11" />
          <path {...common} d="M8 8h3" />
        </>
      )}
      {name === "arrival" && (
        <>
          <path {...common} d="M3 12h10" />
          <path {...common} d="M5 4h8l-2 3 2 3H5z" />
        </>
      )}
      {name === "transfer" && (
        <>
          <path {...common} d="M3 5h9" />
          <path {...common} d="m9 2 3 3-3 3" />
          <path {...common} d="M13 11H4" />
          <path {...common} d="m7 8-3 3 3 3" />
        </>
      )}
      {name === "reverse" && (
        <>
          <path {...common} d="M4 5.5h6.5a2.5 2.5 0 0 1 0 5H7" />
          <path {...common} d="m7 2.5-3 3 3 3" />
          <path {...common} d="m9 7.5 3 3-3 3" />
        </>
      )}
      {name === "formation" && (
        <>
          <path {...common} d="M3 4.5h4v3H3zM9 4.5h4v3H9zM5 7.5v4M11 7.5v4" />
          <path {...common} d="M5 11.5h6M7 6h2" />
        </>
      )}
      {name === "serviceSwitch" && (
        <>
          <path {...common} d="M3 5h4l2 6h4" />
          <path {...common} d="M3 11h4l2-6h4" />
          <path {...common} d="m11 3 2 2-2 2M11 9l2 2-2 2" />
        </>
      )}
      {name === "scenic" && (
        <>
          <path {...common} d="M2.5 11.5 6 6l2.2 3 1.3-1.7 4 4.2" />
          <circle cx="10.8" cy="4.2" r="1.2" fill="currentColor" />
          <path {...common} d="M2.5 12.5h11" />
        </>
      )}
      {name === "warning" && (
        <>
          <path {...common} d="M8 2.8 14 13H2z" />
          <path {...common} d="M8 6.2v3.2" />
          <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
        </>
      )}
      {name === "operation" && (
        <>
          <path {...common} d="M3 11.5h10M4 8h8M5 4.5h6" />
          <path {...common} d="m10 2.8 3 2.7-3 2.7M6 13.2 3 10.5 6 7.8" />
        </>
      )}
      {name === "custom" && (
        <>
          <path {...common} d="M4 3.5h8v9H4z" />
          <path {...common} d="M6 6h4M6 8h4M6 10h2" />
          <circle cx="12" cy="3.5" r="1.1" fill="currentColor" />
        </>
      )}
      {name === "stop" && (
        <>
          <circle {...common} cx="8" cy="8" r="5" />
          <path {...common} d="M5.5 8h5" />
        </>
      )}
      {name === "pass" && (
        <>
          <path {...common} d="M3 8h8" />
          <path {...common} d="m8 5 3 3-3 3" />
          <circle cx="3" cy="8" r="1" fill="currentColor" />
        </>
      )}
      {name === "note" && (
        <>
          <path {...common} d="M4 3.5h6l2 2v8H4z" />
          <path {...common} d="M10 3.5V6h2M6 8h5M6 10.5h4" />
        </>
      )}
      {name === "legacy" && (
        <>
          <path {...common} d="M3 4h10v9H3z" />
          <path {...common} d="M5 6h6M5 8h6M5 10h3" />
        </>
      )}
    </svg>
  );
};

export const RailGraphBadge: React.FC<{
  icon: RailGraphBadgeIcon;
  label?: React.ReactNode;
  value: React.ReactNode;
  tone?: RailGraphBadgeTone;
  title?: string;
  className?: string;
}> = ({ icon, label, value, tone = "slate", title, className = "" }) => (
  <span
    className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${toneClasses[tone]} ${className}`}
    title={title}
  >
    <RailGraphSymbol name={icon} className="h-3 w-3 shrink-0" />
    {label && <span className="shrink-0 opacity-70">{label}</span>}
    <span className="truncate">{value}</span>
  </span>
);

export const RailGraphEventPill: React.FC<{
  type: string;
  label: React.ReactNode;
  title?: string;
  className?: string;
}> = ({ type, label, title, className = "" }) => (
  <span
    className={`inline-flex max-w-[13rem] items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold ${toneClasses[railGraphEventTone(type)]} ${className}`}
    title={title}
  >
    <RailGraphSymbol name={railGraphEventIcon(type)} className="h-3 w-3 shrink-0" />
    <span className="truncate">{label}</span>
  </span>
);

export type Locale = "en" | "ja" | "zh-cn" | "zh-tw";

export const useT = (
  locale: string | undefined,
  labels?: Record<string, string>,
): ((key: string) => string) => {
  const table = translations[locale ?? "en"] ?? translations.en;
  return (key: string) => {
    if (labels?.[key]) return labels[key];
    return table[key] ?? translations.en[key] ?? key;
  };
};

export const promoRandom = (locale: string): string => {
  const list = promoTaglines[locale] ?? promoTaglines.en;
  return list[Math.floor(Math.random() * list.length)];
};

export function detectLocale(): Locale {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("zh-tw") || lang.startsWith("zh-hk") || lang.startsWith("zh-hant")) return "zh-tw";
  if (lang.startsWith("zh")) return "zh-cn";
  return "en";
}

const translations: Record<string, Record<string, string>> = {
  en: {
    routeSlicePreview: "Route Slice Preview",
    resetView: "Reset view",
    promoText: "Created by ",
    promoLink: "RailLOOP",
    promoUser: " user. ",
    promoCTA: "Want to try this?",
  },
  ja: {
    routeSlicePreview: "区間プレビュー",
    resetView: "表示をリセット",
    promoText: "",
    promoLink: "RailLOOP",
    promoUser: "ユーザーにより作成。",
    promoCTA: "試してみますか？",
  },
  "zh-cn": {
    routeSlicePreview: "区间预览",
    resetView: "重置视图",
    promoText: "由 ",
    promoLink: "RailLOOP",
    promoUser: " 用户创建。",
    promoCTA: "想要试试？",
  },
  "zh-tw": {
    routeSlicePreview: "區間預覽",
    resetView: "重置視圖",
    promoText: "由 ",
    promoLink: "RailLOOP",
    promoUser: " 用戶創建。",
    promoCTA: "想要試試？",
  },
};

const promoTaglines: Record<string, string[]> = {
  en: [
    "Connecting the dots into tracks.",
    "From Shinkansen to local lines — log it all.",
    "Your railway diary awaits.",
    "Every station tells a story. Log yours.",
    "Turn your trips into maps.",
    "Since trainspotting deserves better tools.",
    "Does the geojson stuff better than your memory.",
    "Of rail fans, by rail fans, for rail fans.",
    "The long and winding track.",
    "Country tracks, take me home."
  ],
  ja: [
    "全ての鉄道旅を記録しよう。",
    "新幹線からローカル線まで — 全部ログ。",
    "あなたの鉄道日記がここに。",
    "すべての駅に物語がある。あなたの物語を残そう。",
    "旅を地図に変える。",
    "汽笛一声新橋を",
    "もっとスマートに乗り鉄管理。",
    "単なる地図じゃない — あなたの鉄道メモリー。",
    "鉄道ファンが、鉄道ファンのために作った。",
  ],
  "zh-cn": [
    "规划到回忆, 陪你到退坑.",
    "我们时刻前进, 但兼容旧的接口, 废线与回忆.",
    "我们包容一切数据记录, 除了不正乘车.",
    "每个车站都有故事。记录你的。",
    "把旅途变成地图。",
    "越过高山, 越过平原。",
    "不只是地图 —— 你的铁道记忆。",
    "由铁道迷，为铁道迷打造。",
  ],
  "zh-tw": [
    "記錄每一段鐵道冒險。開始你的旅程。",
    "從新幹線到地方線 —— 全部記下來。",
    "你的鐵道日記在等你。",
    "每個車站都有故事。記錄你的。",
    "把旅途變成地圖。",
    "高山青，澗水藍",
    "因為鐵道迷值得更好的工具。",
    "不只是地圖 —— 你的鐵道記憶。",
    "由鐵道迷，為鐵道迷打造。",
  ],
};

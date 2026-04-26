import type { RouteSliceData } from "../components/mdx/types";

interface SerializeInput {
  stations: { id: string; name_ja: string; name_en?: string; lat: number; lng: number }[];
  routeCoords: [number, number][];
  distance: string;
  time: string;
  color: string | null;
  paths?: {
    stations: { id: string; name_ja: string; name_en?: string; lat: number; lng: number }[];
    routeCoords: [number, number][];
    color: string | null;
    meta: {
      icon?: string | null;
      logo?: string | null;
      companyIcon?: string | null;
      recolor?: boolean;
      color?: string | null;
      lineKey: string;
      lineName: string;
    } | null;
  }[];
  routeMode?: "auto" | "manual";
  pathSegments?: {
    lineKey: string;
    fromId: string;
    toId: string;
    loopVia?: "up" | "down";
    fromName?: string;
    toName?: string;
  }[];
  meta: {
    icon?: string | null;
    logo?: string | null;
    companyIcon?: string | null;
    recolor?: boolean;
    color?: string | null;
    lineKey: string;
    lineName: string;
  };
}

interface SerializeOptions {
  inlineLogos?: boolean;
  coordPrecision?: number;
}

const MAX_LOGO_SIZE_BYTES = 64 * 1024; // 64KB

async function imageUrlToDataUri(url: string): Promise<string | null> {
  try {
    // Resolve relative URLs against current origin
    const absoluteUrl = url.startsWith("http")
      ? url
      : window.location.origin + "/" + url.replace(/^\//, "");

    const res = await fetch(absoluteUrl, { mode: "cors" });
    if (!res.ok) return null;

    const blob = await res.blob();
    if (blob.size > MAX_LOGO_SIZE_BYTES) return null;

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function inlineMetaLogos(
  meta:
    | {
        icon?: string | null;
        logo?: string | null;
        companyIcon?: string | null;
      }
    | null
    | undefined,
) {
  if (!meta) return;
  for (const field of ["icon", "logo", "companyIcon"] as const) {
    const val = meta[field];
    if (!val || val.startsWith("data:")) continue;
    const dataUri = await imageUrlToDataUri(val);
    if (dataUri) meta[field] = dataUri;
  }
}

export async function serializeRouteData(
  input: SerializeInput,
  options: SerializeOptions = {},
): Promise<RouteSliceData> {
  const { inlineLogos = true, coordPrecision = 4 } = options;

  // 1. Coordinate precision reduction
  const routeCoords: [number, number][] = input.routeCoords.map(
    ([lat, lng]) => [parseFloat(lat.toFixed(coordPrecision)), parseFloat(lng.toFixed(coordPrecision))] as [number, number],
  );

  // 2. Station simplification
  const stations = input.stations.map((st) => ({
    id: st.id,
    name_ja: st.name_ja,
    ...(st.name_en ? { name_en: st.name_en } : {}),
    lat: st.lat,
    lng: st.lng,
  }));

  // 3. Logo inlining
  const meta: RouteSliceData["meta"] = input.meta
    ? {
        icon: input.meta.icon ?? null,
        logo: input.meta.logo ?? null,
        companyIcon: input.meta.companyIcon ?? null,
        recolor: input.meta.recolor ?? false,
        color: input.meta.color ?? null,
        lineKey: input.meta.lineKey,
        lineName: input.meta.lineName,
      }
    : null;

  const paths = (input.paths ?? []).map((path) => ({
    stations: path.stations.map((st) => ({
      id: st.id,
      name_ja: st.name_ja,
      ...(st.name_en ? { name_en: st.name_en } : {}),
      lat: st.lat,
      lng: st.lng,
    })),
    routeCoords: path.routeCoords.map(([lat, lng]) => [
      parseFloat(lat.toFixed(coordPrecision)),
      parseFloat(lng.toFixed(coordPrecision)),
    ]) as [number, number][],
    color: path.color ?? null,
    meta: path.meta
      ? {
          icon: path.meta.icon ?? null,
          logo: path.meta.logo ?? null,
          companyIcon: path.meta.companyIcon ?? null,
          recolor: path.meta.recolor ?? false,
          color: path.meta.color ?? null,
          lineKey: path.meta.lineKey,
          lineName: path.meta.lineName,
        }
      : null,
  }));

  if (inlineLogos) {
    await inlineMetaLogos(meta);
    for (const path of paths) {
      await inlineMetaLogos(path.meta);
    }
  }

  // Build result, strip undefined
  const result: RouteSliceData = {
    stations,
    routeCoords,
    distance: input.distance,
    time: input.time,
    color: input.color ?? null,
    meta,
    paths,
    routeMode: input.routeMode ?? "auto",
    pathSegments: input.pathSegments ?? [],
  };

  return JSON.parse(JSON.stringify(result));
}

import type { Pin, RailGraphActiveSelection, RailwayMap } from "../store";
import type { MileageEventsOpenDetail } from "./mileageEventUiBridge";
import { lineLabel } from "./mileageUserEvents";

export interface PinMileageEventBridgePayload {
  activeSelection: Omit<RailGraphActiveSelection, "updatedAt">;
  openDetail: MileageEventsOpenDetail;
}

export function pinMileageEventBridgePayload(args: {
  pin: Pick<Pin, "lat" | "lng" | "comment" | "imageUrl">;
  lineKey: string;
  railwayData: RailwayMap;
}): PinMileageEventBridgePayload | null {
  const lineKey = args.lineKey;
  if (!lineKey || !args.railwayData[lineKey]) return null;

  const label = lineLabel(lineKey);
  const mapPoint = { lat: args.pin.lat, lng: args.pin.lng };

  return {
    activeSelection: {
      kind: "axis",
      source: "legacy_geojson",
      lineKey,
      label: label || lineKey,
      color: args.railwayData[lineKey]?.meta?.color ?? undefined,
      geometrySource: "geojson",
      anchor: mapPoint,
    },
    openDetail: {
      mode: "create",
      lineKey,
      source: "legacy_app",
      create: {
        source: "map",
        lineKey,
        mapPoint,
        title: args.pin.comment || "",
        mediaUrl: args.pin.imageUrl || "",
        tags: ["pin"],
      },
    },
  };
}

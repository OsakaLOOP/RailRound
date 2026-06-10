/**
 * @vitest-environment jsdom
 */
import * as L from "leaflet";
import { describe, expect, it } from "vitest";
import {
  createScenicVisibilityLayer,
  updateScenicVisibilityLayer,
  type ScenicVisibilityMapItem,
} from "../components/map/scenicVisibilityLayer";

function item(overrides: Partial<ScenicVisibilityMapItem> = {}): ScenicVisibilityMapItem {
  return {
    id: "scenic:test",
    lat: 35.68,
    lng: 139.76,
    color: "#0ea5e9",
    title: "Scenic test",
    status: "visible",
    bearingDegrees: 90,
    angleToleranceDegrees: 30,
    selected: false,
    dimmed: false,
    ...overrides,
  };
}

describe("scenic visibility Leaflet layer", () => {
  it("creates a first-class fan, ray, and origin marker for scenic visibility", () => {
    const layer = createScenicVisibilityLayer(item()) as L.LayerGroup;
    const layers = layer.getLayers();

    expect(layers).toHaveLength(3);
    expect(layers[0]).toBeInstanceOf(L.Polygon);
    expect(layers[1]).toBeInstanceOf(L.Polyline);
    expect(layers[2]).toBeInstanceOf(L.CircleMarker);
    expect((layers[0] as L.Polygon).options.interactive).toBe(false);
    expect((layers[1] as L.Polyline).options.pane).toBe("mileageEventsPane");
  });

  it("updates geometry and status style without recreating the layer group", () => {
    const layer = createScenicVisibilityLayer(item()) as L.LayerGroup;
    const [, rayBefore] = layer.getLayers();

    updateScenicVisibilityLayer(layer, item({
      lat: 35.7,
      lng: 139.8,
      status: "angle_mismatch",
      bearingDegrees: 135,
      angleToleranceDegrees: 45,
      selected: true,
    }));

    const [, rayAfter, originAfter] = layer.getLayers();
    expect(rayAfter).toBe(rayBefore);
    expect((rayAfter as L.Polyline).options.dashArray).toBe("6 5");
    expect((rayAfter as L.Polyline).options.weight).toBe(3);
    expect((originAfter as L.CircleMarker).getLatLng().lat).toBeCloseTo(35.7);
    expect((originAfter as L.CircleMarker).getLatLng().lng).toBeCloseTo(139.8);
  });
});

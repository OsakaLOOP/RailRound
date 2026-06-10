import { describe, expect, it } from "vitest";
import { computeAndSerializeRoute, ROUTE_EXPORT_ERRORS } from "../utils/routeSerializer";
import { TEST_RAILWAY_MAP } from "./fixtures/railwayData";

describe("route serializer user-facing errors", () => {
  it("does not expose raw line or station ids when manual route export cannot resolve stations", async () => {
    await expect(computeAndSerializeRoute({
      mode: "manual",
      railwayData: TEST_RAILWAY_MAP,
      geoData: null,
      segments: [{
        lineKey: "JR-East:Yamanote",
        fromId: "internal:missing:from",
        toId: "internal:missing:to",
      }],
    }, { inlineLogos: false })).rejects.toThrow(ROUTE_EXPORT_ERRORS.missingStation);

    await expect(computeAndSerializeRoute({
      mode: "manual",
      railwayData: TEST_RAILWAY_MAP,
      geoData: null,
      segments: [{
        lineKey: "JR-East:Yamanote",
        fromId: "internal:missing:from",
        toId: "internal:missing:to",
      }],
    }, { inlineLogos: false })).rejects.not.toThrow(/internal:missing|JR-East:Yamanote/);
  });
});

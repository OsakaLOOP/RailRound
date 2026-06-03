import { describe, expect, it } from "vitest";
import { getSegmentKey, computeLoopVia } from "../core/railwayRouting";
import type { RailwayMap } from "../store";

describe("Trip Segment Key & Loop Routing Utility Tests", () => {
  const mockRailwayData: RailwayMap = {
    "JR-East:Yamanote": {
      meta: {
        company: "JR-East",
        region: "Kanto",
        type: "JR",
        isLoop: true,
        logo: null,
      },
      stations: [
        { id: "tokyo", name_ja: "东京", lat: 35.6812, lng: 139.7671, transfers: [] },
        { id: "shimbashi", name_ja: "新桥", lat: 35.6664, lng: 139.7583, transfers: [] },
        { id: "shinagawa", name_ja: "品川", lat: 35.6301, lng: 139.7388, transfers: [] },
        { id: "shibuya", name_ja: "涩谷", lat: 35.6580, lng: 139.7016, transfers: [] },
        { id: "shinjuku", name_ja: "新宿", lat: 35.6896, lng: 139.7003, transfers: [] },
        { id: "ikebukuro", name_ja: "池袋", lat: 35.7289, lng: 139.7104, transfers: [] },
        { id: "ueno", name_ja: "上野", lat: 35.7138, lng: 139.7773, transfers: [] },
      ],
    },
    "JR-East:Chuo": {
      meta: {
        company: "JR-East",
        region: "Kanto",
        type: "JR",
        isLoop: false,
        logo: null,
      },
      stations: [
        { id: "tokyo", name_ja: "东京", lat: 35.6812, lng: 139.7671, transfers: [] },
        { id: "shinjuku", name_ja: "新宿", lat: 35.6896, lng: 139.7003, transfers: [] },
        { id: "mitaka", name_ja: "三鹰", lat: 35.7027, lng: 139.5604, transfers: [] },
      ],
    },
  };

  describe("computeLoopVia", () => {
    it("correctly identifies shorter direction on a loop line", () => {
      const via1 = computeLoopVia(mockRailwayData, "JR-East:Yamanote", "tokyo", "shimbashi");
      expect(via1).toBe("up");

      const via2 = computeLoopVia(mockRailwayData, "JR-East:Yamanote", "tokyo", "ueno");
      expect(via2).toBe("down");
    });

    it("defaults to up for linear lines if direction is forward, and down if backward", () => {
      const via1 = computeLoopVia(mockRailwayData, "JR-East:Chuo", "tokyo", "shinjuku");
      expect(via1).toBe("up");

      const via2 = computeLoopVia(mockRailwayData, "JR-East:Chuo", "shinjuku", "tokyo");
      expect(via2).toBe("down");
    });
  });

  describe("getSegmentKey", () => {
    it("returns correct key for linear lines without loop directions", () => {
      const key = getSegmentKey(mockRailwayData, "JR-East:Chuo", "tokyo", "shinjuku");
      expect(key).toBe("JR-East:Chuo_tokyo_shinjuku");
    });

    it("respects explicit up/down directions on loop lines", () => {
      const keyUp = getSegmentKey(mockRailwayData, "JR-East:Yamanote", "tokyo", "shimbashi", "up");
      expect(keyUp).toBe("JR-East:Yamanote_tokyo_shimbashi_up");

      const keyDown = getSegmentKey(mockRailwayData, "JR-East:Yamanote", "tokyo", "shimbashi", "down");
      expect(keyDown).toBe("JR-East:Yamanote_tokyo_shimbashi_down");
    });

    it("resolves auto/undefined values for loop lines using computeLoopVia", () => {
      const keyAuto = getSegmentKey(mockRailwayData, "JR-East:Yamanote", "tokyo", "shimbashi", "auto");
      expect(keyAuto).toBe("JR-East:Yamanote_tokyo_shimbashi_up");

      const keyUndefined = getSegmentKey(mockRailwayData, "JR-East:Yamanote", "tokyo", "ueno");
      expect(keyUndefined).toBe("JR-East:Yamanote_tokyo_ueno_down");
    });
  });
});

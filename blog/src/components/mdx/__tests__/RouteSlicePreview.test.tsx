import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteSlicePreview } from "../RouteSlicePreview";

const fetchAndParseDataMock = vi.fn();
const computeAndSerializeRouteMock = vi.fn();
const resetViewMock = vi.fn();

vi.mock("../../../../../src/components/common/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../../../../src/components/LineLogo", () => ({
  LineLogo: () => <div data-testid="line-logo" />,
}));

vi.mock("../../../../../src/utils/fetchAndParseData", () => ({
  fetchAndParseData: () => fetchAndParseDataMock(),
}));

vi.mock("../../../../../src/utils/routeSerializer", () => ({
  computeAndSerializeRoute: (...args: unknown[]) =>
    computeAndSerializeRouteMock(...args),
}));

vi.mock("../useLeafletMap", () => ({
  useLeafletMap: () => ({
    mapInstanceRef: { current: null },
    routeLayerRef: { current: null },
    mapReady: false,
    fitBounds: vi.fn(),
    resetView: resetViewMock,
    getL: () => null,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, payload?: Record<string, string>) => {
      if (key === "loadingRoute") {
        return `Loading route data: ${payload?.key} (${payload?.start} - ${payload?.end})...`;
      }
      const map: Record<string, string> = {
        routeSlicePreview: "Route Slice Preview",
        parseFail: "Failed to render route slice",
        resetView: "Reset View",
      };
      return map[key] ?? key;
    },
  }),
}));

const baseRouteData = {
  stations: [
    { id: "s1", name_ja: "A", lat: 1, lng: 2 },
    { id: "s2", name_ja: "B", lat: 3, lng: 4 },
  ],
  routeCoords: [
    [1, 2],
    [3, 4],
  ] as [number, number][],
  color: "#39C5BB",
  distance: "12.5",
  paths: [
    {
      stations: [
        { id: "s1", name_ja: "A", lat: 1, lng: 2 },
        { id: "s2", name_ja: "B", lat: 3, lng: 4 },
      ],
      routeCoords: [
        [1, 2],
        [3, 4],
      ] as [number, number][],
      color: "#39C5BB",
      meta: { lineKey: "JR:Y", lineName: "Yamanote" },
    },
  ],
  meta: { lineKey: "JR:Y", lineName: "Yamanote" },
};

describe("blog mdx RouteSlicePreview", () => {
  beforeEach(() => {
    fetchAndParseDataMock.mockReset();
    computeAndSerializeRouteMock.mockReset();
    resetViewMock.mockReset();
    fetchAndParseDataMock.mockResolvedValue({ railwayData: {}, geoData: {} });
  });

  it("renders success state and supports reset action", async () => {
    computeAndSerializeRouteMock.mockResolvedValue(baseRouteData);

    render(
      <RouteSlicePreview
        lineKey="JR:Y"
        startStation="A"
        endStation="B"
        mode="auto"
      />,
    );

    expect(
      screen.getByText("Loading route data: JR:Y (A - B)..."),
    ).toBeInTheDocument();

    await screen.findByText("Route Slice Preview");
    expect(screen.getByText("12.5 km")).toBeInTheDocument();
    expect(screen.getByText("Yamanote")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Reset View"));
    expect(resetViewMock).toHaveBeenCalledTimes(1);
  });

  it("renders error panel when route serialization fails", async () => {
    computeAndSerializeRouteMock.mockRejectedValue(new Error("serialize failed"));

    render(
      <RouteSlicePreview
        lineKey="JR:Y"
        startStation="A"
        endStation="B"
        mode="auto"
      />,
    );

    await screen.findByText("Failed to render route slice");
    expect(screen.getByText("serialize failed")).toBeInTheDocument();
  });

  it("supports mode switch between manual and auto", async () => {
    computeAndSerializeRouteMock.mockImplementation((params: any) =>
      Promise.resolve({
        ...baseRouteData,
        distance: params.mode === "manual" ? "8.0" : "12.5",
      }),
    );

    render(
      <RouteSlicePreview
        lineKey="JR:Y"
        startStation="A"
        endStation="B"
        manualSegments={[
          {
            lineKey: "JR:Y",
            fromStation: "A",
            toStation: "B",
          },
        ]}
        enableModeSwitch
      />,
    );

    await waitFor(() =>
      expect(computeAndSerializeRouteMock).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "manual" }),
        expect.any(Object),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Auto" }));

    await waitFor(() =>
      expect(computeAndSerializeRouteMock).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "auto" }),
        expect.any(Object),
      ),
    );
  });
});

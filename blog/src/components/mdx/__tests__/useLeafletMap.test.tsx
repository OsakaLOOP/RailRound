import React, { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLeafletMap } from "../useLeafletMap";

const scrollEnableMock = vi.fn();
const scrollDisableMock = vi.fn();
const mapRemoveMock = vi.fn();
const tileAddToMock = vi.fn();
const layerGroupAddToMock = vi.fn();
const mapMock = {
  scrollWheelZoom: {
    enable: scrollEnableMock,
    disable: scrollDisableMock,
  },
  remove: mapRemoveMock,
  invalidateSize: vi.fn(),
  fitBounds: vi.fn(),
};

vi.mock("leaflet", () => ({
  default: {
    map: vi.fn(() => mapMock),
    tileLayer: vi.fn(() => ({
      addTo: tileAddToMock,
    })),
    layerGroup: vi.fn(() => ({
      addTo: layerGroupAddToMock,
    })),
  },
}));

function HookProbe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mapReady } = useLeafletMap({ containerRef });
  return (
    <div>
      <div data-testid="map-container" ref={containerRef} />
      <span data-testid="map-ready">{mapReady ? "ready" : "pending"}</span>
    </div>
  );
}

describe("blog mdx useLeafletMap", () => {
  beforeEach(() => {
    scrollEnableMock.mockReset();
    scrollDisableMock.mockReset();
    mapRemoveMock.mockReset();
    tileAddToMock.mockReset();
    layerGroupAddToMock.mockReset();
  });

  it("initializes map and toggles scroll zoom by hover", async () => {
    render(<HookProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("map-ready")).toHaveTextContent("ready"),
    );

    const mapContainer = screen.getByTestId("map-container");
    fireEvent.mouseEnter(mapContainer);
    fireEvent.mouseLeave(mapContainer);

    expect(scrollEnableMock).toHaveBeenCalledTimes(1);
    expect(scrollDisableMock).toHaveBeenCalledTimes(1);
    expect(tileAddToMock).toHaveBeenCalled();
    expect(layerGroupAddToMock).toHaveBeenCalled();
  });

  it("cleans up leaflet map on unmount", async () => {
    const { unmount } = render(<HookProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("map-ready")).toHaveTextContent("ready"),
    );

    unmount();
    expect(mapRemoveMock).toHaveBeenCalledTimes(1);
  });
});

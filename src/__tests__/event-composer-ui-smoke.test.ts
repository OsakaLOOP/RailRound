/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { EventComposer } from "../components/mileage-events/EventComposer";
import { useStore, type GlobalStore } from "../store";
import { TEST_RAILWAY_MAP } from "./fixtures/railwayData";
import { mileageEventUiEvents } from "../utils/mileageEventUiBridge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof fallback === "string" ? fallback : _key;
      const values = typeof fallback === "object" && fallback !== null ? fallback : options;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
    },
  }),
}));

describe("EventComposer rail-graph source card UI smoke", () => {
  let initialState: GlobalStore;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    initialState = useStore.getState();
    useStore.setState(initialState, true);
    useStore.getState().setRailwayData(TEST_RAILWAY_MAP);
    useStore.getState().setTrips([]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useStore.setState(initialState, true);
  });

  it("shows responsive source cards with explicit disabled state for missing trips", () => {
    act(() => {
      root.render(React.createElement(EventComposer, { defaultSource: "trip" }));
    });

    const sourceGrid = host.querySelector(".grid.grid-cols-1.sm\\:grid-cols-2");
    expect(sourceGrid).toBeTruthy();
    expect(host.textContent).toContain("No trip selected");
    expect(host.textContent).toContain("Add a trip before creating an event from trip position.");

    const createButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Create event")
    );
    expect(createButton).toBeTruthy();
    expect(createButton).toHaveProperty("disabled", true);
  });

  it("keeps map-source center request reachable from the composer", () => {
    const requested = vi.fn();
    window.addEventListener(mileageEventUiEvents.requestMapCenter, requested);

    act(() => {
      root.render(React.createElement(EventComposer, { defaultSource: "map" }));
    });

    const useCenterButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use map center")
    );
    expect(useCenterButton).toBeTruthy();

    act(() => {
      useCenterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(requested).toHaveBeenCalledTimes(1);
    window.removeEventListener(mileageEventUiEvents.requestMapCenter, requested);
  });

  it("uses trip summary labels instead of raw trip ids in linked trip options", () => {
    useStore.getState().setTrips([
      {
        id: "internal-trip-id",
        date: "2026-06-05",
        segments: [
          {
            id: "segment:1",
            lineKey: "JR-East:Yamanote",
            fromId: "JR-East:Yamanote:Tokyo",
            toId: "JR-East:Yamanote:Ueno",
          },
        ],
      },
    ]);

    act(() => {
      root.render(React.createElement(EventComposer));
    });

    const linkedTripOptions = Array.from(host.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Linked trip"))
      ?.querySelectorAll("option");
    const optionText = Array.from(linkedTripOptions ?? []).map((option) => option.textContent).join(" ");

    expect(optionText).toContain("2026-06-05");
    expect(optionText).toContain("Legacy GeoJSON");
    expect(optionText).toContain("Yamanote");
    expect(optionText).not.toContain("internal-trip-id");
  });
});

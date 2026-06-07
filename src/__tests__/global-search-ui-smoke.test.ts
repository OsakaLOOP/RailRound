/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { GlobalSearchModal } from "../components/modals/GlobalSearchModal";
import { useStore, type GlobalStore } from "../store";
import { TEST_RAILWAY_MAP } from "./fixtures/railwayData";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof fallback === "string" ? fallback : _key;
      const values = typeof fallback === "object" && fallback !== null ? fallback : options;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
    },
  }),
}));

describe("GlobalSearchModal rail-graph trip result UI smoke", () => {
  let initialState: GlobalStore;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    initialState = useStore.getState();
    useStore.setState(initialState, true);
    useStore.getState().setRailwayData(TEST_RAILWAY_MAP);
    useStore.getState().setTrips([
      {
        id: "internal-search-trip-id",
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
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useStore.setState(initialState, true);
  });

  it("allows trip-id search without showing the raw trip id as result text", () => {
    act(() => {
      root.render(React.createElement(GlobalSearchModal, {
        isOpen: true,
        isEmbedded: true,
        onClose: vi.fn(),
        onSelect: vi.fn(),
      }));
    });

    const input = host.querySelector("input");
    expect(input).toBeTruthy();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      valueSetter?.call(input, "internal-search-trip-id");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.textContent).toContain("2026-06-05");
    expect(host.textContent).toContain("Yamanote");
    expect(host.textContent).toContain("東京");
    expect(host.textContent).toContain("上野");
    expect(host.textContent).not.toContain("internal-search-trip-id");
  });
});

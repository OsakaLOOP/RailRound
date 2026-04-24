import { useEffect, useRef, useState, useCallback } from "react";
import type L from "leaflet";

// Static side-effect import — Vite processes & bundles this CSS even with client:only,
// unlike "style"-field CSS attached to dynamic import("leaflet").
import "leaflet/dist/leaflet.css";

interface UseLeafletMapOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useLeafletMap({ containerRef }: UseLeafletMapOptions) {
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const savedBoundsRef = useRef<L.LatLngBounds | null>(null);
  const LRef = useRef<typeof L | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;

    // Toggle scroll-zoom on hover — avoids stealing page scroll when not hovering
    const onEnter = () => mapInstanceRef.current?.scrollWheelZoom.enable();
    const onLeave = () => mapInstanceRef.current?.scrollWheelZoom.disable();
    container.addEventListener("mouseenter", onEnter);
    container.addEventListener("mouseleave", onLeave);

    const init = async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default || leaflet;

      if (cancelled || !containerRef.current) return;

      LRef.current = L;

      const map = L.map(container, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        { subdomains: "abcd", maxZoom: 20 },
      ).addTo(map);

      const routeLayer = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
      routeLayerRef.current = routeLayer;
      setMapReady(true);
    };

    init();

    return () => {
      cancelled = true;
      container.removeEventListener("mouseenter", onEnter);
      container.removeEventListener("mouseleave", onLeave);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        routeLayerRef.current = null;
        savedBoundsRef.current = null;
        setMapReady(false);
      }
    };
  }, []);

  const fitBounds = useCallback(
    (bounds: L.LatLngBounds, padding: [number, number] = [30, 30]) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      savedBoundsRef.current = bounds;

      // Double rAF ensures CSS layout & container sizing has resolved,
      // replacing the fragile setTimeout(150) previously used.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const m = mapInstanceRef.current;
          if (!m) return;
          m.invalidateSize();
          m.fitBounds(bounds, { padding });
        });
      });
    },
    [],
  );

  const resetView = useCallback(() => {
    const map = mapInstanceRef.current;
    const bounds = savedBoundsRef.current;
    if (!map || !bounds) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const m = mapInstanceRef.current;
        if (!m) return;
        m.invalidateSize();
        m.fitBounds(bounds, { padding: [30, 30] });
      });
    });
  }, []);

  const getL = useCallback((): typeof L | null => {
    return LRef.current;
  }, []);

  return {
    mapInstanceRef,
    routeLayerRef,
    mapReady,
    fitBounds,
    resetView,
    getL,
  };
}

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Locate, LocateFixed, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store";

type LocateStatus = "idle" | "locating" | "located";
const ZOOM_LEVELS = [14, 16, 18];

export const LocateButton: React.FC = () => {
  const [status, setStatus] = useState<LocateStatus>("idle");
  const [zoomIndex, setZoomIndex] = useState(0);

  const { t } = useTranslation();

  const statusRef = useRef<LocateStatus>("idle");
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync for event listeners
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const resetToIdle = useCallback(() => {
    if (statusRef.current !== "idle") {
      setStatus("idle");
      setZoomIndex(0);
    }
  }, []);

  useEffect(() => {
    const handleUserInteraction = () => {
      resetToIdle();
    };

    window.addEventListener("map:user-interaction", handleUserInteraction);
    return () => {
      window.removeEventListener("map:user-interaction", handleUserInteraction);
    };
  }, [resetToIdle]);

  const handleLocate = () => {
    if (status === "locating") return;

    if (status === "idle") {
      setStatus("locating");
      setZoomIndex(0);

      if (!navigator.geolocation) {
        toast.error(t("map.geoNotSupported", "浏览器不支持地理定位"));
        setStatus("idle");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          coordsRef.current = { lat, lng };

          setStatus("located");
          // Fly to location with first zoom level (14)
          window.dispatchEvent(
            new CustomEvent("map:fly-to-location", {
              detail: { lat, lng, zoom: ZOOM_LEVELS[0] },
            }),
          );
        },
        (error) => {
          console.error("Geolocation error:", error);
          let errMsg = t("map.geoFail", "定位获取失败");
          if (error.code === error.PERMISSION_DENIED) errMsg = t("map.geoDenied", "定位权限被拒绝");
          else if (error.code === error.POSITION_UNAVAILABLE)
            errMsg = t("map.geoUnavailable", "无法获取位置信息");
          else if (error.code === error.TIMEOUT) errMsg = t("map.geoTimeout", "定位超时");

          toast.error(errMsg);
          setStatus("idle");
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        },
      );
    } else if (status === "located" && coordsRef.current) {
      // Cycle through zooms
      const nextIndex = (zoomIndex + 1) % ZOOM_LEVELS.length;
      setZoomIndex(nextIndex);

      window.dispatchEvent(
        new CustomEvent("map:fly-to-location", {
          detail: {
            lat: coordsRef.current.lat,
            lng: coordsRef.current.lng,
            zoom: ZOOM_LEVELS[nextIndex],
          },
        }),
      );
    }
  };

  const handleLongPress = () => {
    if (status === "locating") return;

    // Get the coords either from current ref if we have it, or fetch it right away
    const executeAction = (lat: number, lng: number) => {
        setStatus("located");
        setZoomIndex(2); // Start at z18 since we are jumping to it

        window.dispatchEvent(
            new CustomEvent("map:fly-to-location", {
                detail: { lat, lng, zoom: 18 },
            }),
        );

        // Show station menus
        import("../../core/railwayRouting").then(({ findNearbyStations }) => {
            const railwayData = useStore.getState().railwayData;
            const nearby = findNearbyStations(railwayData, lat, lng, 5);

            if (nearby && nearby.length > 0) {
                window.dispatchEvent(
                    new CustomEvent("map:show-nearby-stations", {
                        detail: { stations: nearby }
                    })
                );
            }
        });
    };

    if (coordsRef.current && status === "located") {
        executeAction(coordsRef.current.lat, coordsRef.current.lng);
    } else {
        if (!navigator.geolocation) {
            toast.error(t("map.geoNotSupported", "浏览器不支持地理定位"));
            return;
        }
        setStatus("locating");
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                coordsRef.current = { lat, lng };
                executeAction(lat, lng);
            },
            (error) => {
                let errMsg = t("map.geoFail", "定位获取失败");
                if (error.code === error.PERMISSION_DENIED) errMsg = t("map.geoDenied", "定位权限被拒绝");
                else if (error.code === error.POSITION_UNAVAILABLE) errMsg = t("map.geoUnavailable", "无法获取位置信息");
                else if (error.code === error.TIMEOUT) errMsg = t("map.geoTimeout", "定位超时");
                toast.error(errMsg);
                setStatus("idle");
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
  };

  const handlePointerDown = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
        pressTimerRef.current = null;
        handleLongPress();
    }, 600);
  };

  const handlePointerUp = () => {
      if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
          handleLocate();
      }
  };

  const handlePointerLeave = () => {
      if (pressTimerRef.current) {
          clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
      }
  };

  return (
    <div className="absolute bottom-20 right-4 z-[400] flex flex-col gap-3">
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        disabled={status === "locating"}
        className={`p-3 rounded-full shadow-lg transition-all active:scale-95 flex items-center justify-center w-12 h-12
                    ${
                      status === "idle"
                        ? "bg-white text-gray-700 hover:bg-gray-50"
                        : status === "locating"
                          ? "bg-white text-blue-500 cursor-not-allowed"
                          : "bg-blue-500 text-white"
                    }`}
      >
        {status === "idle" && <Locate size={24} />}
        {status === "locating" && (
          <Loader2 size={24} className="animate-spin" />
        )}
        {status === "located" && <LocateFixed size={24} />}
      </button>
    </div>
  );
};

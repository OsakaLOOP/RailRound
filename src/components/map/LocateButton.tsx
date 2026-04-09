import React, { useState, useRef, useEffect, useCallback } from "react";
import { Locate, LocateFixed, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

type LocateStatus = "idle" | "locating" | "located";
const ZOOM_LEVELS = [14, 16, 18];

export const LocateButton: React.FC = () => {
  const [status, setStatus] = useState<LocateStatus>("idle");
  const [zoomIndex, setZoomIndex] = useState(0);

  const statusRef = useRef<LocateStatus>("idle");
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);

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
        toast.error("浏览器不支持地理定位");
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
          let errMsg = "定位获取失败";
          if (error.code === error.PERMISSION_DENIED) errMsg = "定位权限被拒绝";
          else if (error.code === error.POSITION_UNAVAILABLE)
            errMsg = "无法获取位置信息";
          else if (error.code === error.TIMEOUT) errMsg = "定位超时";

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

  return (
    <div className="absolute bottom-20 right-4 z-[400] flex flex-col gap-3">
      <button
        onClick={handleLocate}
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

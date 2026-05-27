import { useCallback } from "react";
import { useStore } from "../../store";
import { useShallow } from "zustand/react/shallow";
import { useUserData } from "../../hooks/useUserData";
import type { UserEventV2 } from "../../rail-graph-v1/mileage-event.types";

export function useMileageEventActions() {
  const {
    user,
    trips,
    pins,
    folders,
    badgeSettings,
    mileageUserEvents,
    setMileageUserEvents,
  } = useStore(
    useShallow((state) => ({
      user: state.user,
      trips: state.trips,
      pins: state.pins,
      folders: state.folders,
      badgeSettings: state.badgeSettings,
      mileageUserEvents: state.mileageUserEvents,
      setMileageUserEvents: state.setMileageUserEvents,
    }))
  );
  const { saveData } = useUserData();

  const persistEvents = useCallback(
    (nextEvents: UserEventV2[]) => {
      setMileageUserEvents(nextEvents);
      if (!user?.token) return;
      saveData(user.token, trips, pins, folders, badgeSettings, nextEvents).catch((error) => {
        console.error("Mileage event sync failed", error);
      });
    },
    [badgeSettings, folders, pins, saveData, setMileageUserEvents, trips, user?.token],
  );

  const addEvent = useCallback(
    (event: UserEventV2) => {
      persistEvents([...mileageUserEvents, event]);
    },
    [mileageUserEvents, persistEvents],
  );

  const updateEvent = useCallback(
    (event: UserEventV2) => {
      persistEvents(mileageUserEvents.map((item) => (item.id === event.id ? event : item)));
    },
    [mileageUserEvents, persistEvents],
  );

  const removeEvent = useCallback(
    (id: string) => {
      persistEvents(mileageUserEvents.filter((event) => event.id !== id));
    },
    [mileageUserEvents, persistEvents],
  );

  const importEvents = useCallback(
    (events: UserEventV2[]) => {
      const merged = new Map<string, UserEventV2>();
      mileageUserEvents.forEach((event) => merged.set(event.id, event));
      events.forEach((event) => {
        if (event?.id) merged.set(event.id, event);
      });
      persistEvents(Array.from(merged.values()));
    },
    [mileageUserEvents, persistEvents],
  );

  return {
    events: mileageUserEvents,
    addEvent,
    updateEvent,
    removeEvent,
    importEvents,
    persistEvents,
  };
}

1.  **Analyze the Performance Bottleneck:**
    *   In `src/pages/TripsPage.tsx` and `src/components/modals/WalkTripEditor.tsx`, there are instances of iterating over the *entire* `railwayData` object (which is a large map of transit lines and their stations) using `Object.values(railwayData).forEach(...)`.
    *   This is done simply to find a station's name given its ID (`trip.fromId` and `trip.toId`).
    *   `railwayData` contains hundreds of lines and thousands of stations. Iterating through all of them for every walk trip rendered on the `TripsPage` is an O(N*M) operation (where N is the number of walk trips, and M is the total number of lines, and we also do a `.find` on stations). This is a classic "unnecessary loop" and a very common React rendering bottleneck.
    *   It's also done inside the `WalkTripEditor` component, both in render and in `onSave`.

2.  **Proposed Optimization:**
    *   Use a constant-time O(1) lookup map (a `stationIdMap`) to resolve station IDs to their names.
    *   Since `railwayData` is immutable from Zustand and only updates when loaded, we can construct this `stationMap` once and memoize it, or construct it on the fly efficiently, or just utilize a `useMemo` at the top level of the component.
    *   Even simpler, since `railwayData` keys *are not* the line keys inside `station.id` directly, we need a flat map of `station.id -> station`.
    *   Looking at `src/core/railwayRouting.ts`, we see it's possible the `railwayData` isn't huge enough to crash, but doing it inside `.map` of trips is bad.
    *   Let's create a `useMemo` in `TripsPage.tsx` to build a `Map<string, string>` (ID to name) from `railwayData`.
    *   Let's do the same for `WalkTripEditor.tsx`.

3.  **Refactoring `TripsPage.tsx`:**
    *   Add:
        ```typescript
        const stationNameMap = useMemo(() => {
            const map = new Map<string, string>();
            for (const key in railwayData) {
                const line = railwayData[key];
                if (line.stations) {
                    for (let i = 0; i < line.stations.length; i++) {
                        const s = line.stations[i];
                        map.set(s.id, s.name_ja);
                    }
                }
            }
            return map;
        }, [railwayData]);
        ```
    *   Replace `Object.values(railwayData).forEach...` with:
        ```typescript
        const startName = stationNameMap.get(trip.fromId) || '';
        const endName = stationNameMap.get(trip.toId) || '';
        ```

4.  **Refactoring `WalkTripEditor.tsx`:**
    *   Do the exact same `useMemo` mapping for `WalkTripEditor.tsx`.
    *   Wait, in `WalkTripEditor.tsx` `onSave` it also needs `startCoords` and `endCoords`.
    *   So let's build a `stationDataMap` that maps `id -> station`.

    ```typescript
    const stationDataMap = useMemo(() => {
        const map = new Map<string, any>();
        for (const key in railwayData) {
            const line = railwayData[key];
            if (line.stations) {
                for (let i = 0; i < line.stations.length; i++) {
                    map.set(line.stations[i].id, line.stations[i]);
                }
            }
        }
        return map;
    }, [railwayData]);
    ```

    *   Then `let startName = stationDataMap.get(form.fromId)?.name_ja || t('walk.unknownStart', "未知起点");`

5.  **Verify:** Check for syntax errors and build the app locally to ensure everything works correctly. Update `.jules/bolt.md` with the learning about O(N x M) rendering bottlenecks.

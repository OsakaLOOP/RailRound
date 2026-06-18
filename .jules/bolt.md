## 2026-03-31 - [Optimized Iteration over large collections]
**Learning:** Found an opportunity to replace chained array methods like flatMap, map, reduce, and Object.values/keys with single-pass manual 'for' and 'for...in' loops when processing arrays and objects to avoid allocating large temporary data structures. Used ES6 Maps/Sets where efficient counting/deduplication was needed.
**Action:** Apply this pattern to other performance sensitive areas where objects and arrays map over large datasets, and ensure that iteration checks 'Object.prototype.hasOwnProperty.call()' when utilizing 'for...in'. Note: This project lacks a package.json at the root so standard npm/pnpm lint tools might not be readily available.

## 2024-04-15 - [Avoid O(N log N) Sorting on Massive Geographical Collections]
**Learning:** In spatial queries like `findNearbyStations` where we scan `railwayData` containing thousands of stations to find the top K nearest points, allocating all elements to an array and running `Array.prototype.sort()` results in massive temporary object allocation and $O(N \log N)$ execution time (taking ~8.5ms in benchmarks).
**Action:** Replace full array sorts with a bounded Top-K array using a simple $O(K)$ insertion sort during the $O(N)$ iteration phase. This brings the time complexity effectively down to $O(N)$, speeding up operations by ~36x (taking ~0.24ms). Remember to apply a final sort if total elements found are less than $K$.

## 2024-06-18 - [Avoid Turf.js Object Allocation in Distance Calculations]
**Learning:** Computing map distances in hot paths or large iteration loops using `turf.length(turf.lineString(coords))` creates massive garbage collection pressure and CPU overhead because it repeatedly allocates GeoJSON objects and parses them internally.
**Action:** Replace `turf.length` with the specialized utility `calcPolylineDist(coords)` in `src/core/tripCalculator.js` which performs an $O(N)$ iteration over the coordinate array using `calcDist` without creating intermediate objects.

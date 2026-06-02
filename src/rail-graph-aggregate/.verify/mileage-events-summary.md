# Mileage-Centric UserEvent Verify Summary

- aggregateKey: `senseki-tohoku`
- source: `legacy-projected`
- patterns: **4**
- mileage events: **3**

## Checks
- ✅ aggregate compatibility entry returns events
- ✅ events are mileage-only records
- ✅ legacy station/edge anchors are projected through aggregate entry
- ✅ single ServicePattern projection returns events
- ✅ single ServicePattern events sorted by run mileage
- ✅ cross-pattern path resolved
- ✅ cross-pattern projection keeps global mileage order
- ✅ queryEventsByMileage returns current events
- ✅ station place resolves to mileage
- ✅ place query projects place to mileage before matching
- ✅ time query projects time range to mileage range
- ✅ time query exposes inference diagnostics or timestamps
- ✅ app wrapper fixture builds line context
- ✅ app create wrappers produce mileage-only events
- ✅ app create wrappers do not persist station anchor as primary event state
- ✅ app queryEventsByMileage wrapper returns line events
- ✅ app queryEventsNearPlace wrapper resolves place before matching
- ✅ app queryEventsByTime wrapper uses linear fallback
- ✅ app queryEventsByTime wrapper exposes timestamp inference
- ✅ app projectEventsToTrip wrapper keeps trip mileage order
- ✅ app queryEventsByTrip aliases trip projection
- ✅ app queryEventsByText wrapper supports text and tag filters
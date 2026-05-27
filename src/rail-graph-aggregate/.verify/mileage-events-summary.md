# Mileage-Centric UserEvent Verify Summary

- aggregateKey: `senseki-tohoku`
- source: `legacy-projected`
- patterns: **3**
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
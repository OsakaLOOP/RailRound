import re

with open('src/workers/geo.worker.js', 'r') as f:
    content = f.read()

# Modify GET_ALL_GEOMETRIES to return a dict with both geometries and visited_stations
search_block = """            case 'GET_ALL_GEOMETRIES':
                // payload.trips
                {
                    const allGeoms = [];
                    payload.trips.forEach(t => {
                        const segs = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
                        segs.forEach(seg => {
                            const g = getGeometry(seg);
                            if (g && g.coords) {
                                allGeoms.push({
                                    id: seg.id || `${seg.lineKey}_${seg.fromId}_${seg.toId}`,
                                    coords: g.coords,
                                    color: g.color,
                                    isMulti: g.isMulti,
                                    popup: `${seg.lineKey}` // Simplified popup
                                });
                            }
                        });
                    });
                    result = allGeoms;
                }
                break;"""

replace_block = """            case 'GET_ALL_GEOMETRIES':
                // payload.trips
                {
                    const allGeoms = [];
                    const visitedStations = new Map(); // Use Map to dedup stations by ID

                    payload.trips.forEach(t => {
                        const segs = t.segments || [{ lineKey: t.lineKey, fromId: t.fromId, toId: t.toId }];
                        segs.forEach(seg => {
                            const g = getGeometry(seg);
                            if (g && g.coords) {
                                allGeoms.push({
                                    id: seg.id || `${seg.lineKey}_${seg.fromId}_${seg.toId}`,
                                    coords: g.coords,
                                    color: g.color,
                                    isMulti: g.isMulti,
                                    popup: `${seg.lineKey}` // Simplified popup
                                });
                            }

                            // Extract visited stations for this segment
                            if (railwayData && railwayData[seg.lineKey]) {
                                const line = railwayData[seg.lineKey];
                                const startIdx = line.stations.findIndex(st => st.id === seg.fromId);
                                const endIdx = line.stations.findIndex(st => st.id === seg.toId);

                                if (startIdx !== -1 && endIdx !== -1) {
                                    const step = startIdx <= endIdx ? 1 : -1;
                                    for (let i = startIdx; i !== endIdx + step; i += step) {
                                        if (i >= 0 && i < line.stations.length) {
                                            const st = line.stations[i];
                                            visitedStations.set(st.id, {
                                                lat: st.lat,
                                                lng: st.lng,
                                                name: st.name_ja,
                                                color: g ? g.color : '#38bdf8'
                                            });
                                        }
                                    }
                                }
                            }
                        });
                    });

                    result = {
                        geometries: allGeoms,
                        stations: Array.from(visitedStations.values())
                    };
                }
                break;"""

if search_block in content:
    content = content.replace(search_block, replace_block)
    with open('src/workers/geo.worker.js', 'w') as f:
        f.write(content)
    print("Successfully updated GET_ALL_GEOMETRIES")
else:
    print("Could not find the block to replace")

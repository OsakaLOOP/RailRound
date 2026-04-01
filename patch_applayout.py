import re

with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()

# We need to construct the renderList from trips, since we need to know the segments within a trip
# to insert transfers between them.
# The original logic uses allSegments.map

# Find where allSegments is defined:
# const allSegments = trips.flatMap(t => t.segments || []);

new_logic = """
            // 1. 优先使用已有的缓存进行渲染，保证部分路线立即显示，防止整张地图因为几段缺失而瘫痪。
            const buildRenderList = (cache: Map<string, any>) => {
                const list: any[] = [];
                trips.forEach(trip => {
                    const segs = trip.segments || [];
                    for (let i = 0; i < segs.length; i++) {
                        const seg = segs[i];
                        const key = `${seg.lineKey}_${seg.fromId}_${seg.toId}`;
                        const cached = cache.get(key);
                        const line = railwayData[seg.lineKey];
                        const s1 = line?.stations.find((s: any) => s.id === seg.fromId);
                        const s2 = line?.stations.find((s: any) => s.id === seg.toId);

                        if (cached) {
                            list.push({ id: seg.id || key, popup: `${seg.lineKey}: ${s1?.name_ja || seg.fromId} → ${s2?.name_ja || seg.toId}`, ...cached });
                        }

                        // Check for transfer to the next segment
                        if (i < segs.length - 1) {
                            const nextSeg = segs[i + 1];
                            const nextLine = railwayData[nextSeg.lineKey];
                            const nextS1 = nextLine?.stations.find((s: any) => s.id === nextSeg.fromId);

                            // If they are different stations (by id) but part of a continuous trip, we draw a transfer line
                            if (s2 && nextS1 && s2.id !== nextS1.id) {
                                list.push({
                                    id: `transfer_${trip.id}_${i}`,
                                    coords: [[s2.lat, s2.lng], [nextS1.lat, nextS1.lng]],
                                    color: '#9ca3af', // default gray for transfer
                                    isMulti: false,
                                    fallback: false,
                                    isTransfer: true,
                                    popup: `换乘: ${s2.name_ja} → ${nextS1.name_ja}`
                                });
                            }
                        }
                    }
                });
                return list;
            };

            const renderList = buildRenderList(segmentGeometries);
            setTripSegmentsGeometry(renderList);
"""

# Replace the first instance
content = re.sub(
    r"// 1\. 优先使用已有的缓存进行渲染.*?setTripSegmentsGeometry\(renderList\);",
    new_logic.strip(),
    content,
    flags=re.DOTALL
)

# Replace the second instance
new_logic2 = """
                // 必须在这里同步生成并调用 setTripSegmentsGeometry，
                // 否则首次加载从 IndexedDB 读出的数据将因为 setTimeout/useShallow 导致的依赖丢失而无法触发重新渲染。
                const newRenderList = buildRenderList(newCache);
                setTripSegmentsGeometry(newRenderList);
"""

content = re.sub(
    r"// 必须在这里同步生成并调用 setTripSegmentsGeometry，.*?setTripSegmentsGeometry\(newRenderList\);",
    new_logic2.strip(),
    content,
    flags=re.DOTALL
)

with open('src/AppLayout.tsx', 'w') as f:
    f.write(content)

print("Patched AppLayout.tsx")

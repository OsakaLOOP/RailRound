import L from 'leaflet';

/**
 * 通用的 Leaflet LayerGroup 增量同步工具。
 * 它可以避免 clearLayers() 导致的全部 DOM 销毁和重建。
 *
 * @param layerGroup    需要操作的 L.LayerGroup
 * @param dataArray     最新的数据数组
 * @param getId         从数据项中提取唯一 ID 的函数
 * @param createLayer   为新数据创建 L.Layer 的函数
 * @param updateLayer   更新已有 L.Layer 的函数（如 setLatLng, setStyle）
 */
export function syncLeafletLayerGroup<T>(
    layerGroup: L.LayerGroup,
    dataArray: T[],
    getId: (item: T) => string | number,
    createLayer: (item: T) => L.Layer,
    updateLayer: (layer: L.Layer, item: T) => void
) {
    if (!layerGroup) return;

    // 获取当前 LayerGroup 中已有的 Layer，要求创建时在 layer 上附加了 sourceId
    const existingLayers = new Map<string | number, L.Layer>();
    layerGroup.eachLayer((layer: any) => {
        if (layer.sourceId !== undefined) {
            existingLayers.set(layer.sourceId, layer);
        }
    });

    const newDataIds = new Set<string | number>();

    // 遍历新数据，新增或更新
    dataArray.forEach(item => {
        const id = getId(item);
        newDataIds.add(id);

        const existingLayer = existingLayers.get(id);
        if (existingLayer) {
            // 已存在，执行增量更新
            updateLayer(existingLayer, item);
        } else {
            // 不存在，创建并添加到 LayerGroup
            const newLayer: any = createLayer(item);
            newLayer.sourceId = id; // 附加唯一标识，供下次识别
            layerGroup.addLayer(newLayer);
        }
    });

    // 遍历旧的 Layer，移除在数据中已经不存在的
    existingLayers.forEach((layer, id) => {
        if (!newDataIds.has(id)) {
            layerGroup.removeLayer(layer);
        }
    });
}

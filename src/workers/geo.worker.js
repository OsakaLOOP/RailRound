//几何计算逻辑（calcDist, sliceGeoJsonPath）迁移至 Worker。

//Worker 内部必须维护 railwayData 和 geoData 的内存副本。

//主线程与 Worker 通信必须使用 Promise 包装的 request/response 模式（带 id 标识）。
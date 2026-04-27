# geo.worker GeoJSON 字段契约（2026-04-27）

## 目的

记录 `src/workers/geo.worker.js` 在路径切片时实际依赖的字段，避免每次回读 GeoJSON 与源码。

## 1) 线路匹配规则（核心）

`geo.worker` 通过以下条件在 `geoData.features` 中查找线路 feature：

- `properties.type === 'line'`
- `properties.name === lineName`
  - 这里 `lineName` 来自 `lineKey` 的冒号后半段：`company:lineName`
- `properties.company === company`
  - 这里 `company` 来自 `lineKey` 的冒号前半段

可选方向版本（优先匹配）：

- 当存在方向时，优先找 `properties.direction === 'up' | 'down'`
- 若找不到方向版本，回退到无 `direction` 的同名线路 feature

## 2) 几何类型要求

线路 feature 的 `geometry.type` 支持：

- `LineString`
- `MultiLineString`

`MultiLineString` 会先做拼接/切片，失败时走兜底直连。

## 3) 颜色字段

渲染颜色读取：

- 优先 `properties.stroke`
- 否则默认 `#38bdf8`

## 4) 车站字段（用于切片锚点）

`geo.worker` 不直接从 station feature 取站点，而是用 `railwayData[lineKey].stations` 中的站点坐标切片。

因此真正必需的是：`railwayData` 中每个 segment 的 `fromId/toId` 能在对应线路的 `stations[].id` 找到。

`railwayData` 的站点通常由 parser 从 station feature 构建，station feature 的关键字段为：

- `properties.type === 'station'`
- `properties.line`（线路名，非 lineKey）
- `properties.name`
- `geometry.coordinates = [lng, lat]`
- 可选：`properties.id`（不填会自动生成）
- 可选：`properties.transfers`（换乘 lineKey 列表）
- 可选：`properties.landmark`（地标站）

## 5) 回环线相关

回环线方向判定依赖 `railwayData[lineKey].meta.isLoop`，它来自 line feature 的：

- `properties.isLoop === true | 'true'`

当 segment 带 `loopVia`（`up/down/auto`）时，worker 按该方向切片；否则自动判定。

## 6) 推荐最小模板

### line feature（无方向）

```json
{
  "type": "Feature",
  "properties": {
    "type": "line",
    "company": "示例公司",
    "name": "示例线路",
    "stroke": "#38bdf8"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [[139.0, 35.0], [139.1, 35.1]]
  }
}
```

### line feature（有方向，可选）

```json
{
  "type": "Feature",
  "properties": {
    "type": "line",
    "company": "示例公司",
    "name": "示例线路",
    "direction": "up"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [[139.0, 35.0], [139.1, 35.1]]
  }
}
```

### station feature

```json
{
  "type": "Feature",
  "properties": {
    "type": "station",
    "company": "示例公司",
    "line": "示例线路",
    "name": "示例站",
    "id": "示例公司:示例线路:示例站"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [139.0, 35.0]
  }
}
```

## 7) 与 `network` 设计的直接约束

如果 `network` 也要走现有 worker 渲染链路，必须保证：

- 最终 `lineKey` 仍可拆成 `company:lineName`
- `geoData` 内存在与该 `lineKey` 对应的 line feature（`type/name/company` 对齐）
- segment 的 `fromId/toId` 能在对应 `railwayData[lineKey].stations` 中命中

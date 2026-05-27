设计目标

用户端不应只是“添加备注”。它应该成为一个围绕行程、里程、时间、地点、线路的个人铁路日志系统：

- 记录：用户坐过什么、什么时候、哪条线、从哪到哪。
- 事件：用户在某个里程点发生/记录了什么。
- 地图：用户在哪里查看、创建、筛选事件。
- 时间线：用户按乘车顺序回顾事件。
- 数据接口：同一事件可按里程、地点、时间、线路、行程、标签多维查询。

核心不变量继续保持：UserEvent 本体只绑定 mileage，地点/时间/站点只是查询和创建入口。

整体 UI 架构

保留当前底部三入口：

- records：行程记录中心
- map：地图探索与事件创建
- stats：统计和个人数据

新增一个跨页面的用户数据层：

- MileageEventCenter
- TripRecordTimeline
- EventInspector
- EventComposer
- EventSearchPanel

它们不新增第四个底部 tab，而是嵌入现有页面：

- 地图页右侧：事件浮层
- 记录页：行程卡片内事件摘要 + 行程详情事件流
- 统计页：事件统计、标签、常用地点、记录质量提示

地图页 UI

地图页是最常用入口，应覆盖快速查看、创建、查询。

地图右上角提供一个 事件 图标按钮，打开可收起侧栏。

侧栏分四个 tab：

- 沿线
  - 选择线路
  - 显示该线路所有事件
  - 按里程排序
  - 每条显示：标题、里程、附近站、时间推断、标签
- 地点
  - 选择车站 / 地图点击 / 当前定位
  - 半径查询：500m / 1km / 3km
  - 查询过程：地点 → mileage → event
- 时间
  - 输入时间窗口
  - 使用 timetable 或 linear fallback 投影到 mileage
  - 显示“实际时间 / 估算时间 / 未绑定”
- 创建
  - 从当前选中站点创建
  - 从当前地图点创建
  - 从当前线路里程创建
  - 从最近一次行程位置创建

创建表单字段：

- 标题
- 正文
- 类型：备注 / 风景 / 提醒 / 运营提示 / 自定义
- 可见性：私有 / 共享 / 公开
- 标签
- 照片 URL 或附件占位
- 关联行程，可选
- 关联线路，可选
- 里程自动生成，不允许用户手动保存 station anchor

地图表现：

- 事件点使用小型圆点或 pin，不使用大卡片遮挡地图。
- 同线路事件按线路色弱关联。
- 点击事件点打开 inspector。
- hover/选中时高亮对应线路区间。
- 多事件同里程聚合为数字 badge。

记录页 UI

记录页应该从“行程列表”升级成“行程 + 事件回放”。

每个 Trip card 增加事件摘要：

详情抽屉结构：

- 顶部：日期、线路段、距离、时间
- 中部：分段 timeline
- 下部：事件流

事件流按行程 mileage 排序：

0.0 km 东京 出发
4.2 km 备注 看到特别涂装
12.8 km 风景 河桥视野
23.5 km 横浜 换乘

常用操作：

- 给本次行程添加事件
- 编辑事件
- 删除事件
- 跳转地图定位
- 按标签过滤
- 复制事件摘要
- 导出本次行程含事件 JSON/MDX

记录页顶部新增筛选：

- 日期范围
- 线路
- 公司
- 有事件 / 无事件
- 标签
- 可见性
- 事件类型
- 仅显示待补全记录

事件详情 Inspector

Inspector 是统一详情面板，地图、记录页、搜索结果都打开同一个组件。

内容：

- 标题、类型、可见性
- 里程位置
- 附近站点
- 所在线路 / pattern / system
- 推断时间
- 正文
- 标签
- 关联行程
- 创建/更新时间
- 诊断信息，仅 devMode 显示

操作：

- 编辑
- 删除
- 在地图中查看
- 在记录中查看
- 复制事件链接
- 导出单事件 JSON
- 转为公开/共享
- 从当前行程解绑，但不改变 mileage

搜索体验

全局搜索应扩展为统一搜索：

- 线路
- 车站
- 行程
- 事件
- 标签

搜索结果分组：

- 事件
- 行程
- 车站
- 线路

事件搜索支持：

- 文本
- 标签
- 类型
- 时间范围
- 线路
- 附近地点
- 里程范围

高级入口可以藏在筛选按钮里，不占默认 UI。

数据接口设计

用户端至少暴露这些 API 层：

createMileageEventFromPlace(place, draft): UserEventV2
createMileageEventFromTripPosition(tripRef, position, draft): UserEventV2
queryEventsByMileage(window): UserEventV2[]
queryEventsNearPlace(place, radius): BoundMileageEvent[]
queryEventsByTime(timeWindow): BoundMileageEvent[]
queryEventsByTrip(trip): BoundMileageEvent[]
queryEventsByText(query, filters): UserEventV2[]
projectEventsToTrip(trip): BoundMileageEvent[]

数据维度：

- mileage：主轴
- place：站点、坐标、地图点
- time：真实 timetable / linear fallback
- trip：行程记录
- line/system/pattern：线路和服务
- visibility：私有/共享/公开
- tags：用户组织
- media：照片/外链
- diagnostics：投影质量

常用操作覆盖

必须覆盖：

- 快速添加事件
- 从站点添加事件
- 从地图点添加事件
- 从行程中添加事件
- 按线路查看事件
- 按地点附近查看事件
- 按时间查看事件
- 编辑事件
- 删除事件
- 搜索事件
- 给事件打标签
- 关联/取消关联行程
- 导出/导入事件
- 云端同步事件
- 离线可用
- 投影失败时给出可理解提示

高级但应支持：

- 批量选择事件
- 批量加标签
- 批量改可见性
- 合并重复事件
- 从旧 pins 转换为 mileage events
- 从旧 station/edge aggregate events 转换
- 事件质量检查：缺标题、无标签、投影不稳定、时间只能估算

视觉风格

贴合当前 RailLOOP：

- 使用白色/浅灰面板，细边框，实用信息密度。
- 主色继续 emerald。
- 避免大 hero、装饰卡片、夸张渐变。
- 地图浮层最大宽度约 24rem。
- mobile 上使用底部 sheet。
- desktop 上使用右侧 drawer。
- 操作按钮用 lucide icon：MapPinned、Clock、Search、Plus、Trash2、Tag、Route。

落地顺序

1. 先做统一 EventInspector + EventComposer。
2. 完善地图页事件侧栏。
3. 记录页 Trip detail 接入事件流。
4. 全局搜索接入事件。
5. Stats 页补事件统计。
6. 最后做批量操作和质量检查。

这个设计可以直接拆成下一轮实现 goal：先把用户端事件 UI 从当前基础面板升级成完整事件中心，再把记录页和搜索页接入同一套 mileage event API。

// 现在只是 SPA, 所以考虑利用 outlet 机制引入路由和上下文, 不要搞得全是弹窗.
//实现 Map Keep-Alive。

//地图层：z-0。非地图路由时设置 opacity-0 和 pointer-events-none。

//路由层：z-10。容器设为 pointer-events-none。

//子页面：所有渲染在 <Outlet /> 中的组件（如 RecordsList）必须在最外层 div 设置 pointer-events-auto 和背景色。

//路由定义：

//使用 react-router-dom

//RailRound.jsx 中定义路由：/trips (Index), /map (透明页), /stats, /login (弹窗 Modal), /trip/new (弹窗 Modal) /tutorial(覆盖全屏, 和原先一致)
//注意原先为modal的现在还是modal, 不应该因为路由而视为单独页面.
//必须严格控制ui行为与原先一致, 并且唯一.
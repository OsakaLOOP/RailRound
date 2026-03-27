## 重构
1. 引入 react-router-dom, 实现 SPA 的路由覆盖.(实现 Map Keep-Alive 作为背景, 页面内容/上层组件 Outlet, 实现三个页面的子路由/trips, /map, /user, 以及单独的 /login, 且 login 根据路由历史延续背景ui的一致衔接)
2. 部分 modal 改为兼容全屏.(暂时没用)
3. 文件组织:./feature/..., ./services/..., ./stores, ./components
4. 内部方法的 hook 化
5. 结合 useContext 和 useStore(Zustand + typescript), 优化 props 传递和依赖式更新. (必须确认哪些是全局配置或基础数据, 哪些是高频操作相关)
6. 计算转移到 Web Worker.

## 远景
------
1. 数据层提升
2. 导入导出丰富
3. 精确规划
4. 用户社区交互
5. 小巧思(Chest 等)
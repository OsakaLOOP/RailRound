# RailRound Repo Map & Co-Change Entry Points (2026-04-26)

## 1) Functional blocks

- src/: 主应用（React + Vite）
  - app shell: src/main.jsx, src/RailRound.jsx, src/AppLayout.tsx
  - i18n: src/i18n.ts + public/locales/\*/translation.json
  - UI components: src/components/\*\*
  - business core: src/core/\*\*
  - state/services: src/store/index.ts, src/services/api.js
  - data/utils: src/utils/\*\*
- blog/: Astro 博客子项目（独立构建/测试）
  - content: blog/src/content/blog/{zh-cn,en,ja-jp,zh-tw}/\*.mdx
  - routes/pages: blog/src/pages/\*\*
  - mdx interactive components: blog/src/components/mdx/\*\*
- public/: 运行时静态与 API
  - locales: public/locales/\*/translation.json
  - release metadata: public/changelog.json
  - rail data: public/geojson/\*\*, public/geojson_manifest.json, public/company_data.json
  - edge functions: public/functions/api/\*\*
- scripts/: 发布与构建协同脚本（尤其 release 校验）
- packages/route-slice-preview/: 可复用包（与 blog 组件联动）
- docs/: 方案、审计与发布流程文档
  - geo worker 字段契约: docs/geo_worker_geojson_contract_2026-04-27.md
  - rail graph v1 设计参考: docs/rail-graph-v1/
  - mileage-centric UserEvent 接入文档: docs/rail-graph-v1/user-event-mileage-layer.md
- rail graph MVP 工作台:
  - standalone HTML: rail-graph-mvp.html
  - browser shell/engine adapter: src/rail-graph-v1-mvp/app.ts
  - map/list interaction: src/rail-graph-v1-mvp/map-view.ts, src/rail-graph-v1-mvp/list-view.ts
  - local pipeline model/API client: src/rail-graph-v1-mvp/pipeline.ts
  - Vite dev local task API: scripts/rail-graph-mvp-server.js + vite.config.js plugin
- mileage-centric UserEvent 层:
  - public types/API: src/rail-graph-v1/mileage-event.types.ts, src/rail-graph-v1/mileage-events.ts
  - aggregate compatibility: src/rail-graph-aggregate/user-event/mileage-*.ts
  - user app entry: src/components/map/MileageEventsPanel.tsx, src/utils/mileageUserEvents.ts
  - verify: npm run rail:events:mileage-verify

### Routing / SEO / EdgeOne entry points

- Canonical app route helper: src/utils/routes.js
  - canonical app pages: /:lang/records, /:lang/map, /:lang/stats
  - supported lang: zh-cn, en, ja-jp, zh-tw
  - shared builders for app tabs, blog base, feedback GitHub callback, title/description metadata
- App route consumers:
  - src/AppLayout.tsx (language/tab canonical replace, active tab sync, runtime Helmet SEO)
  - src/components/layout/BottomNav.tsx (tab navigation)
  - src/components/VersionBadge.jsx and src/components/common/ErrorBoundary.tsx (blog links)
  - src/components/modals/FeedbackModal.tsx and src/pages/FeedbackGithubCallbackPage.tsx (feedback callback)
- Static app SEO output:
  - scripts/postbuild.js generates dist/:lang/:tab/index.html, dist/:lang/feedback/github/callback/index.html, compatibility noindex entries, app-sitemap.xml, root sitemap.xml, robots.txt, and dist/edgeone.json.
- Blog routing/SEO:
  - blog/src/utils/blogRouting.ts (blog canonical/hreflang helpers)
  - blog/src/components/BaseHead.astro (canonical, hreflang, OG/Twitter)
  - blog/src/components/RedirectPage.astro (compat redirect noindex + canonical target)
- EdgeOne Pages config:
  - edgeone.json and public/edgeone.json intentionally contain headers only; SPA rewrites are not used.

## 2) High-frequency co-change entry points

### A. UI text / interaction change (main app)

- primary:
  - src/components/\*\* (具体交互与文案)
  - src/i18n.ts (i18next 配置)
  - public/locales/en/translation.json
  - public/locales/ja-JP/translation.json
  - public/locales/zh-CN/translation.json
  - public/locales/zh-TW/translation.json
- often together:
  - src/store/index.ts (语言初始值 i18nextLng)
  - src/utils/alerts.ts (直接 i18next.t)

### B. Version/changelog/release surface

- primary:
  - public/changelog.json
  - src/components/VersionBadge.jsx
  - src/utils/fetchAndParseData.ts (读取 changelog.meta.currentVersion)
- required companion:
  - blog/src/content/blog/<locale>/v{version}.mdx
  - scripts/validate-release-content.mjs
  - docs/next-minor-release-task-plan.md
- build coupling:
  - package.json (root build 会串联 blog build + merge)
  - scripts/merge-blog-dist.js

### C. Blog i18n and release pages

- primary:
  - blog/astro.config.mjs (locales)
  - blog/src/content/blog/{zh-cn,en,ja-jp,zh-tw}/
  - blog/src/components/mdx/i18n.ts
  - blog/src/utils/blogRouting.ts (version->slug)
  - blog/src/components/BaseHead.astro (canonical/hreflang SEO for /blog/:lang/...)
  - blog/src/components/RedirectPage.astro (noindex redirects for compatibility paths)

### D. Rail data ingestion / map data update

- primary:
  - public/geojson/\*\*
  - public/geojson_manifest.json
  - public/company_data.json
- companion:
  - src/utils/fetchAndParseData.ts
  - src/core/bot/botDataBuilder.ts
  - docs/api/bot-integration-guide.md

### D2. Rail Graph MVP local pipeline / workspace

- primary:
  - src/rail-graph-v1-mvp/app.ts
  - src/rail-graph-v1-mvp/pipeline.ts
  - scripts/rail-graph-mvp-server.js
  - vite.config.js
- external tools:
  - D:\GIS\scripts\*.py (PBF extraction, matching, batch decisions, overrides)
- companion:
  - docs/rail-graph-v1/\*
  - rail-graph-mvp.html

### D3. Mileage UserEvent / user-facing event layer

- primary:
  - src/rail-graph-v1/mileage-event.types.ts
  - src/rail-graph-v1/mileage-events.ts
  - docs/rail-graph-v1/user-event-mileage-layer.md
- aggregate compatibility:
  - src/rail-graph-aggregate/user-event/mileage-adapter.ts
  - src/rail-graph-aggregate/user-event/mileage-integration.ts
  - src/rail-graph-aggregate/user-event/mileage-query.ts
  - src/rail-graph-aggregate/user-event/mileage-store.ts
- user-facing app:
  - src/components/map/MileageEventsPanel.tsx
  - src/utils/mileageUserEvents.ts
  - src/store/index.ts
  - src/hooks/useUserData.ts
  - src/services/api.js
  - public/functions/api/user/data.js
- i18n companion:
  - public/locales/en/translation.json
  - public/locales/ja-JP/translation.json
  - public/locales/zh-CN/translation.json
  - public/locales/zh-TW/translation.json
- verification:
  - src/rail-graph-v1-mvp/verify-mileage-user-events.ts
  - npm run rail:events:mileage-verify

### E. API contract related updates

- primary:
  - src/services/api.js
  - public/functions/api/user/data.js
  - public/functions/api/feedback/\*\*
- companion:
  - src/hooks/useUserData.ts
  - src/store/index.ts

## 3) Practical edit bundles (quick checklist)

- 修改主应用 UI 文案:
  - src/components/_ + public/locales/_/translation.json + key 对齐检查
- 发布新版本:
  - public/changelog.json + blog 各语言 vX.mdx + scripts/validate-release-content.mjs 校验通过
- 改后端交互字段:
  - src/services/api.js + public/functions/api/\*\* + store/hook 消费点
- 改轨道数据源:
  - public/geojson\* + company_data + fetchAndParseData + bot builder

## 4) Naming/entry mismatch notes

- "版本更新" 实际入口并非仅 changelog：UI 显示在 src/components/VersionBadge.jsx，数据源在 public/changelog.json，发布详情在 blog/src/content/blog/_/v_.mdx。
- "本地化" 在主应用与 blog 存在双入口：
  - app: i18next + public/locales/\*/translation.json
  - blog: astro i18n + blog/src/components/mdx/i18n.ts + 按语言内容目录

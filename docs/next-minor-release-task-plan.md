# 下一小版本完善任务文档（可直接发布）

## 目标
- 目标A：持续提升结构化、可 SEO 的内容完整性。
- 目标B：提升用户“使用 -> 分享 -> 传播”的闭环效率。
- 版本定位：小版本，强调稳态可交付，不做过大范围扩展。

## 本版优先级（P0 / P1）

### P0-1 内容完整性强校验（构建时）
新增严格校验规则，保证新增版本不再出现“只有 changelog 无详情页”或“详情页无版本映射”的情况。

校验对象：
- `public/changelog.json`
- `blog/src/content/blog/**/v*.mdx`

必须满足：
1. `changelog.logs[*].version` 对应的版本，必须存在 blog 详情页（至少默认语言 `zh-cn`）。
2. 若该版本已启用多语言策略，则要求 `en/ja-jp/zh-tw` 也存在对应页面（可配置为 warning 或 error，建议默认 warning，CI 可切 error）。
3. 每个版本详情页 frontmatter 的 `version` 字段必须与文件名版本一致（如 `v0.51.mdx` 对应 `version: '0.51'`）。
4. 不允许重复版本号（changelog 和 blog 各自都要去重校验）。

输出要求：
- 报错信息包含：版本号、缺失语言、目标文件路径。
- 失败时 `exit 1`，中断构建/提交流程。

---

### P0-2 pre-submit 自动检查（供后续长期复用）
新增统一的预提交检查命令，作为提交前固定动作。

建议脚本：
- `npm run pre-submit`

建议包含：
1. 版本内容一致性检查（P0-1 规则脚本）。
2. 主应用构建：`npm run build`。
3. Blog 构建：`cd blog && npm run build`。
4. 可选：`npm run lint`（若当前仓库 lint 成本过高，先保留开关）。

接入方式：
- 第一步：先提供手动命令（本版必须落地）。
- 第二步（可选）：接入 git hook（如 husky）或 CI job。

---

### P1-1 Blog MDX 组件测试覆盖（小范围）
对新增的 blog MDX 组件补齐基础测试，确保后续重构不破坏可用性。

覆盖对象：
1. `blog/src/components/mdx/RouteSlicePreview.tsx`
2. `blog/src/components/mdx/ErrorBoundary.tsx`
3. `blog/src/components/mdx/useLeafletMap.ts`

最低覆盖目标：
1. 成功态与失败态渲染。
2. 关键交互（模式切换、重置按钮）可用。
3. map hook 初始化与卸载清理行为可验证。

## 本版明确不做（Out of Scope）
1. `trips/[slug]` 动态路由详情页。
2. 社媒图片（OG Image）动态渲染系统。
3. 分享闭环增强（文案模板、复制链路统一等）。
4. 大规模宣传运营动作。

以上统一放入下一个版本，避免本版 scope 膨胀。

## 交付清单
1. 文档与规则脚本：
- 新增“版本内容一致性检查脚本”（建议放 `scripts/`）。
- 新增 `pre-submit` 脚本到 `package.json`。

2. 流程接入：
- 在 README 或开发文档中说明提交前执行 `npm run pre-submit`。

3. 构建验证：
- 主应用构建通过。
- Blog 构建通过。
- 校验脚本在“故意制造缺失版本”时能正确 fail。

## 验收标准（Release Gate）
满足以下全部条件才可发布：
1. 任意新增 `changelog` 版本都能被校验到对应 blog 页面。
2. `npm run pre-submit` 在本地可一键跑通。
3. 主应用和 blog 构建均通过。
4. UI 未引入新的阻断性回归（至少做核心路径冒烟：打开版本日志、跳转详情、返回应用）。

## 执行顺序建议
1. 先做 P0-1（校验脚本）。
2. 再做 P0-2（pre-submit 聚合命令）。
3. 最后做 P1-1（blog MDX 组件测试补齐）。
4. 完成后一次性回归与发布。

## 风险与控制
- 风险：严格规则可能拦截历史不完整内容。
- 控制：
  1. 提供“历史版本白名单”机制（仅限一次性过渡）。
  2. 对多语言先 warning 后 error，分阶段收紧。

## 备注
- 当前战略节奏以“可持续建设能力”为主，不以短期大规模传播为目标。
- 本版重点是打牢“内容完整性 + 提交质量门禁”，为下版本的大范围分享能力（`trips/[slug]` + OG）铺路。

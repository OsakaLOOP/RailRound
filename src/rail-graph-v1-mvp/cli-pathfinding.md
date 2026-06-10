# cli-pathfinding

从 `.railround.json` (Senseki Demo Snapshot) 导出文件中提取和浏览寻路结果。

## 运行

```bash
npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts <file> [options]
```

## 参数

| 参数 | 简写 | 说明 |
|------|------|------|
| `<file>` | | `.railround.json` 路径, 必填 |
| `--name` | `-n` | 按 scenario name 过滤 (子串, 不区分大小写) |
| `--level` | `-l` | 展示层级: `scenarios` / `candidates` / `phases` / `edges` / `detail` |
| `--candidate` | `-c` | candidate 索引 0-based, phases/edges/detail 层有效 |
| `--geo` | | edges 输出含经纬度 |
| `--json` | | 输出原始 JSON |
| `--help` | `-h` | 帮助 |

## 层级说明

| level | 内容 |
|-------|------|
| `scenarios` (默认) | 所有场景概览: name, 通过, 候选数, 最优距离 |
| `candidates` | 某场景的全部候选路径详情 |
| `phases` | 某候选的 phase 分段 (上行/下行/折返) |
| `edges` | 某候选的 edge 序列 — **具体地理列表** |
| `detail` | 完整信息: phases + edges(含坐标) + 折返事件 |

## 示例

```bash
# 列出所有场景
npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts senseki-demo.railround.json

# 按 name 筛选
npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts demo.railround.json -n "S0"

# 查看某场景的候选路径
npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts demo.railround.json -n "S0" -l candidates

# 查看第 0 个候选的 edge 地理列表 (含坐标)
npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts demo.railround.json -n "S0" -l edges --geo

# 查看完整详情
npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts demo.railround.json -n "S0" -l detail

# 输出为 JSON
npx tsx src/rail-graph-v1-mvp/cli-pathfinding.ts demo.railround.json --json
```

# Geo Workspace Debugger API

`geo_workspace_debugger.py` 是一个基于命令行的环境诊断工具，主要用于拉取验证 Web 平台导出的纯配置 `workspace_dump.json`，在脱机状态下定位潜在错误与拓扑间接问题。最新的代码已重构为独立的文件-参数指令系统（Stateless CLI），并能完全独立抽取上/下行单通道以检查“与双向片段连接后的整体结果”。

## 核心类：`GeoDebugger`

该类负责解析导出的 JSON 状态文件，重构内部路线拓扑。

### 轨道流体提取与校验
- **`__init__(self, filepath)`:** 读取 JSON 工作流状态切片。
- **`get_track_flow(self, direction='up')`:** 逻辑模拟与构建通道矩阵数组。对指定方向进行梳理（抽取全线路 `merged` 以及按需抽取 `up` 或 `down` 属性线段）。在此过程中下行（`down`）会自动将其内部区段倒序拼装以及把每一个独立段落内部坐标矩阵逆向翻转，以达到完全按照行进方向连携的目的。
- **`analyze_flow(self, direction)`:** 检查通过流体产生的拓扑片段集合，利用距离计算公式验证前者的末尾与后者的开头，分别报出超过 5 米的端对端缝隙 `Gap`，以及所有低于 10 米门槛（`SHORT_SEGMENT_THRESHOLD`）的无意义短线段碎片。
- **`check_duplicate_segments(self)`:** 双重校验模式：排查引用的冲突以及空间距离高度重合点。

## 命令行传参用法

**基础运行模式**
默认检查（会自动按序给出上行视图、下行视图与整体冗余通告）：
```powershell
python d:\PROJ\GIT\PyDesign\RailRound\scripts\geo_workspace_debugger.py workspace_dump.json
```

**参数列表**
* `--summary`: 只打印总体流向断层审查（等效于默认无参运行方式），包括上下双向通道与问题坐标段总结。
* `--view <BLOCK_IDX>`: 定向微观排查命令，如输入 `--view 2` 将屏蔽摘要功能，只输出该序号所对应区块内（包含上/下/合流各自序列池）全部具体的物理线段列表和内部点位经纬坐标组。
* `--delete-block <BLOCK_IDX>`: 【修改态】移除指定序号（0-N）的区块，并将修改后的结构原地覆盖写入原 JSON 文件。
* `--swap-blocks <IDX1> <IDX2>`: 【修改态】交换两个序号区块的前后位置（例如针对拼接错位），自动保存。
* `--delete-seg <SEG_ID>`: 【修改态】在所有线路轨道结构中检索指定的线段 ID（支持只输入末端显示的最后 8 位字符作模糊匹配），剔除该断代碎片并自动保存。

**环境限制**
* 本pc为win11, 日本地区编码, 需要手动指定utf-8.
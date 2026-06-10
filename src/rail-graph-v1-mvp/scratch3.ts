import { SENSEKI_RAIL, SENSEKI_STATIONS } from "./senseki-data";
import { SENSEKI_PF_OVERRIDES, runSensekiScenarios, summarizeSensekiResults, type SensekiScenarioResult } from "./poc-senseki-pathfinding";
import { loadGeoJson, importGeoJson, compileTopology, state } from "./app";

// 1. 加载数据
loadGeoJson(SENSEKI_RAIL);
importGeoJson(SENSEKI_STATIONS);

// 2. 模拟 localStorage / 手动应用 Overrides (因为 node 环境下没有 window.localStorage)
if (state.source) {
  state.source = {
    ...state.source,
    features: state.source.features.map((f) => {
      const id = f.properties.railGraph?.id;
      if (id && SENSEKI_PF_OVERRIDES[id]) {
        return {
          ...f,
          properties: {
            ...f.properties,
            railGraph: SENSEKI_PF_OVERRIDES[id],
          },
        };
      }
      return f;
    }),
  };
}

// 3. 编译拓扑
const topo = compileTopology();

// 4. 运行寻路
console.log("Running Senseki pathfinding scenarios...");
const results = runSensekiScenarios(topo);
const summary = summarizeSensekiResults(results as SensekiScenarioResult[]);

console.log("Pathfinding Results Summary:");
console.log(JSON.stringify(summary, null, 2));

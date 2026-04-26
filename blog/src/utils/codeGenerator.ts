import type { RouteSliceData } from "../components/mdx/types";

const CDN_BASE = "https://rail.s3xyseia.xyz/bundle";

interface GenerateOptions {
  locale?: "en" | "ja" | "zh-cn" | "zh-tw";
  height?: string;
  theme?: "light" | "dark";
  showPromo?: boolean;
  packageSource?: "npm" | "cdn";
}

function generateImport(packageSource: "npm" | "cdn"): string {
  if (packageSource === "cdn") {
    return `<script type="module">
import { RouteSlicePreview } from "${CDN_BASE}/route-slice-preview.js";
</script>`;
  }
  return `import { RouteSlicePreview } from "@railloop/route-slice-preview";
import "@railloop/route-slice-preview/styles.css";`;
}

function generateDataJson(data: RouteSliceData): string {
  return JSON.stringify(data)
    .replace(/"stations"/g, "stations")
    .replace(/"routeCoords"/g, "routeCoords")
    .replace(/"distance"/g, "distance")
    .replace(/"time"/g, "time")
    .replace(/"color"/g, "color")
    .replace(/"meta"/g, "meta")
    .replace(/"id"/g, "id")
    .replace(/"name_ja"/g, "name_ja")
    .replace(/"name_en"/g, "name_en")
    .replace(/"lat"/g, "lat")
    .replace(/"lng"/g, "lng")
    .replace(/"version"/g, "version")
    .replace(/"icon"/g, "icon")
    .replace(/"logo"/g, "logo")
    .replace(/"companyIcon"/g, "companyIcon")
    .replace(/"recolor"/g, "recolor")
    .replace(/"lineKey"/g, "lineKey")
    .replace(/"lineName"/g, "lineName");
}

export function generateSinglePreview(
  data: RouteSliceData,
  options: GenerateOptions = {},
): string {
  const { locale = "en", height = "400px", theme = "light", showPromo = true, packageSource = "npm" } = options;

  const importStmt = generateImport(packageSource);
  const dataJson = generateDataJson(data);

  const props = [
    `client:only="react"`,
    `data={${dataJson}}`,
    `locale="${locale}"`,
    `height="${height}"`,
    `theme="${theme}"`,
    `showPromo={${showPromo}}`,
  ].join("\n  ");

  return `${importStmt}

<RouteSlicePreview
  ${props}
/>`;
}

export function generateMultiPreview(
  dataList: RouteSliceData[],
  options: GenerateOptions = {},
): string {
  const { locale = "en", height = "400px", theme = "light", showPromo = true, packageSource = "npm" } = options;

  const importStmt = generateImport(packageSource);

  const blocks = dataList
    .map((data, i) => {
      const dataJson = generateDataJson(data);
      const props = [
        `client:only="react"`,
        `data={${dataJson}}`,
        `locale="${locale}"`,
        `height="${height}"`,
        `theme="${theme}"`,
        `showPromo={${showPromo}}`,
      ].join("\n  ");
      return `<!-- Route ${i + 1} -->
<RouteSlicePreview
  ${props}
/>`;
    })
    .join("\n\n<hr />\n\n");

  return `${importStmt}

${blocks}`;
}

import type { RouteSliceData } from "./routeExportTypes";

const CDN_BASE = "https://rail.s3xyseia.xyz/bundle";

interface CodeOptions {
  locale?: string;
  height?: string;
  theme?: string;
  showPromo?: boolean;
  packageSource?: "npm" | "cdn";
}

function generateImport(pkg: "npm" | "cdn"): string {
  if (pkg === "cdn") {
    return `<script type="module">
import { RouteSlicePreview } from "${CDN_BASE}/route-slice-preview.js";
</script>`;
  }
  return `import { RouteSlicePreview } from "@railloop/route-slice-preview";
import "@railloop/route-slice-preview/styles.css";`;
}

export function generateRouteMdx(
  data: RouteSliceData,
  options: CodeOptions = {},
): string {
  const {
    locale = "en",
    height = "400px",
    theme = "light",
    showPromo = true,
    packageSource = "npm",
  } = options;

  const importStmt = generateImport(packageSource);
  const dataJson = JSON.stringify(data);
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

export function generateMultiRouteMdx(
  dataList: RouteSliceData[],
  options: CodeOptions = {},
): string {
  const {
    locale = "en",
    height = "400px",
    theme = "light",
    showPromo = true,
    packageSource = "npm",
  } = options;

  const importStmt = generateImport(packageSource);
  const blocks = dataList
    .map((data, i) => {
      const dataJson = JSON.stringify(data);
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

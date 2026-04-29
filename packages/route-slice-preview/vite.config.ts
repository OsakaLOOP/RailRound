import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "RailLOOPRouteSlicePreview",
      formats: ["es", "cjs", "umd"],
      fileName: (format) => {
        if (format === "es") return "index.mjs";
        if (format === "cjs") return "index.cjs";
        return "index.umd.js";
      },
    },
    rollupOptions: {
      external: ["react", "react-dom", "leaflet", "lucide-react"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          leaflet: "L",
          "lucide-react": "lucideReact",
        },
      },
    },
    cssCodeSplit: false,
  },
});

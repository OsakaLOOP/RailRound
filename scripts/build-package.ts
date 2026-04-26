/**
 * Build script for @railloop/route-slice-preview
 *
 * Steps:
 * 1. Copy source files from blog/src/components/mdx/ to packages/route-slice-preview/src/
 * 2. Run vite build in packages/route-slice-preview/
 * 3. Copy dist/ to public/bundle/
 */

import { copyFileSync, mkdirSync, readdirSync, existsSync, rmSync, writeFileSync } from "fs";
import { resolve, basename } from "path";
import { execSync } from "child_process";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(ROOT, "blog/src/components/mdx");
const TARGET = resolve(ROOT, "packages/route-slice-preview/src");
const PACKAGE_DIR = resolve(ROOT, "packages/route-slice-preview");
const BUNDLE_DIR = resolve(ROOT, "public/bundle");

// Files to copy (RouteSlicePreview.tsx is excluded — it imports from ../../../../src/)
const FILES_TO_COPY = [
  "RouteSlicePreviewStatic.tsx",
  "types.ts",
  "i18n.ts",
  "useLeafletMap.ts",
  "ErrorBoundary.tsx",
  "PromoBanner.tsx",
  "LineLogo.tsx",
  "leaflet-map.css",
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function cleanTarget() {
  if (existsSync(TARGET)) {
    rmSync(TARGET, { recursive: true, force: true });
  }
}

function copySources() {
  ensureDir(TARGET);
  for (const file of FILES_TO_COPY) {
    const src = resolve(SOURCE, file);
    const dst = resolve(TARGET, file);
    if (!existsSync(src)) {
      console.warn(`  ⚠ Source not found: ${src}`);
      continue;
    }
    copyFileSync(src, dst);
    console.log(`  ✓ ${file}`);
  }
  // Create the package entry point
  writeFileSync(
    resolve(TARGET, "index.ts"),
    `export { RouteSlicePreview } from "./RouteSlicePreviewStatic";\nexport type { RouteSliceData, StationData, RouteSliceMeta, RouteSlicePathData, RouteSliceMode, RouteSlicePathSegment } from "./types";\n`,
    "utf-8",
  );
  console.log("  ✓ index.ts (generated)");
}

function buildPackage() {
  console.log("\n📦 Building package...");
  execSync("npx vite build", {
    cwd: PACKAGE_DIR,
    stdio: "inherit",
  });
}

function generateDeclarations() {
  try {
    execSync("npx tsc --emitDeclarationOnly --project tsconfig.json", {
      cwd: PACKAGE_DIR,
      stdio: "pipe",
    });
    console.log("  ✓ index.d.ts generated");
  } catch {
    console.warn("  ⚠ Type declarations skipped (tsc not configured for declarations)");
  }
}

function copyToBundle() {
  // Clean old bundle files first
  if (existsSync(BUNDLE_DIR)) {
    const oldFiles = readdirSync(BUNDLE_DIR);
    for (const f of oldFiles) rmSync(resolve(BUNDLE_DIR, f), { force: true });
  }
  ensureDir(BUNDLE_DIR);
  const distDir = resolve(PACKAGE_DIR, "dist");
  // Map dist filenames to CDN bundle filenames
  const renameMap: Record<string, string> = {
    "index.mjs": "route-slice-preview.js",
    "index.cjs": "route-slice-preview.cjs",
    "index.umd.js": "route-slice-preview.umd.js",
  };

  for (const [srcName, dstName] of Object.entries(renameMap)) {
    const src = resolve(distDir, srcName);
    if (!existsSync(src)) {
      console.warn(`  ⚠ ${srcName} not found, skipping`);
      continue;
    }
    const dst = resolve(BUNDLE_DIR, dstName);
    copyFileSync(src, dst);
    console.log(`  ✓ ${srcName} → ${dstName}`);
  }
  // Copy CSS separately (keeps original name)
  const cssFile = resolve(distDir, "route-slice-preview.css");
  if (existsSync(cssFile)) {
    copyFileSync(cssFile, resolve(BUNDLE_DIR, "route-slice-preview.css"));
    console.log("  ✓ route-slice-preview.css");
  }
}

// Main
console.log("🏗  Building @railloop/route-slice-preview\n");
console.log("Step 1: Cleaning target dir...");
cleanTarget();

console.log("Step 2: Copying source files...");
copySources();

console.log("\nStep 3: Building package...");
buildPackage();

console.log("\n📝 Generating type declarations...");
generateDeclarations();

console.log("\nStep 4: Copying bundle to public/...");
copyToBundle();

console.log("\n✅ Build complete!");
console.log(`   📦 Package: ${resolve(PACKAGE_DIR, "dist")}`);
console.log(`   🌐 Bundle:  ${BUNDLE_DIR}`);

import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const mainDist = path.resolve(rootDir, "dist");
const blogDist = path.resolve(rootDir, "blog", "dist");
const targetBlogDist = path.resolve(mainDist, "blog");

function copyRecursiveSync(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const child of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    }
    return;
  }

  const parent = path.dirname(dest);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

if (!fs.existsSync(mainDist)) {
  console.error("dist/ not found, run root build first.");
  process.exit(1);
}
if (!fs.existsSync(blogDist)) {
  console.error("blog/dist/ not found, run blog build first.");
  process.exit(1);
}

copyRecursiveSync(blogDist, targetBlogDist);
console.log(`Merged blog dist into ${targetBlogDist}`);
